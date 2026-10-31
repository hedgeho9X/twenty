"""Parse archived recruiting files and render complete previews; never run uploaded code."""
import asyncio
import hashlib
import io
import json
import logging
import os
import secrets
import shutil
import subprocess
import zipfile
from pathlib import Path
from uuid import UUID

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from PIL import Image

INPUT_ROOT = Path(os.environ.get("RECRUITING_INPUT_ROOT", "/data/input")).resolve()
OUTPUT_ROOT = Path(os.environ.get("RECRUITING_OUTPUT_ROOT", "/data/output")).resolve()
MODEL_ROOT = Path(os.environ.get("RECRUITING_MODEL_ROOT", "/models/docling")).resolve()
TOKEN = os.environ.get("RECRUITING_PARSER_TOKEN", "")
PARSER_VERSION = "docling-2.145.0-preview-v1"
MAX_BYTES = 50 * 1024 * 1024
MAX_PAGES = 80
Image.MAX_IMAGE_PIXELS = 40_000_000
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
parse_lock = asyncio.Lock()
converter = None
logger = logging.getLogger("recruiting-parser")


class ParseRequest(BaseModel):
    """File keys are supplied by the authenticated CRM, not filesystem paths from users."""
    requestId: UUID
    storageKey: str = Field(min_length=1, max_length=2048)
    originalName: str = Field(min_length=1, max_length=512)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    resources: dict[str, str] = Field(default_factory=dict, max_length=100)


def source_file(key: str) -> Path:
    """Resolve symlinks before checking the storage boundary."""
    path = (INPUT_ROOT / key).resolve()
    if not path.is_relative_to(INPUT_ROOT) or not path.is_file():
        raise ValueError("invalid_storage_key")
    if path.stat().st_size > MAX_BYTES:
        raise ValueError("file_too_large")
    return path


def file_hash(path: Path) -> str:
    """Hash material bytes without retaining open descriptors across queued requests."""
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def identify(path: Path, original_name: str) -> str:
    """Inspect bytes before falling back to text extensions; MIME labels are only hints."""
    with path.open("rb") as stream:
        header = stream.read(16)
    if header.startswith(b"%PDF-"):
        return "pdf"
    if header.startswith(b"PK"):
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > 10_000 or sum(entry.file_size for entry in entries) > 100 * 1024 * 1024:
                raise ValueError("unsafe_document_archive")
            if "word/document.xml" in archive.namelist():
                return "docx"
        raise ValueError("unsupported_archive")
    if header.startswith(bytes.fromhex("d0cf11e0a1b11ae1")):
        import olefile
        with olefile.OleFileIO(path) as document:
            if not document.exists("WordDocument"):
                raise ValueError("unsupported_legacy_document")
        return "doc"
    try:
        with Image.open(path) as image:
            if image.width * image.height > 40_000_000:
                raise ValueError("image_too_large")
            if getattr(image, "n_frames", 1) > 1:
                raise ValueError("multi_frame_image_requires_review")
            image.verify()
        return "image"
    except (Image.UnidentifiedImageError, OSError):
        pass
    extension = Path(original_name).suffix.lower()
    kinds = {".txt": "text", ".html": "html", ".htm": "html", ".md": "markdown", ".markdown": "markdown"}
    if extension not in kinds:
        raise ValueError("unsupported_format")
    return kinds[extension]


def get_converter():
    """Load one shared CPU parser; the request lock prevents concurrent model initialization."""
    global converter
    if converter is None:
        from docling.datamodel.accelerator_options import AcceleratorOptions
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions
        from docling.document_converter import DocumentConverter, ImageFormatOption, PdfFormatOption
        options = PdfPipelineOptions(
            artifacts_path=MODEL_ROOT, document_timeout=120,
            accelerator_options=AcceleratorOptions(device="cpu", num_threads=4),
            do_ocr=True, do_table_structure=True, enable_remote_services=False,
            allow_external_plugins=False, ocr_options=RapidOcrOptions(backend="onnxruntime"),
        )
        converter = DocumentConverter(format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=options),
            InputFormat.IMAGE: ImageFormatOption(pipeline_options=options),
        })
    return converter


def render_pdf(pdf: Path, output: Path) -> list[str]:
    """Render every PDF page, refusing oversized documents instead of omitting pages."""
    import pypdfium2 as pdfium
    document = pdfium.PdfDocument(pdf)
    if len(document) > MAX_PAGES:
        document.close()
        raise ValueError("too_many_pages")
    names = []
    try:
        for index in range(len(document)):
            page = document[index]
            width, height = page.get_size()
            if width * height * 1.5 * 1.5 > 40_000_000:
                page.close()
                raise ValueError("pdf_page_too_large")
            bitmap = page.render(scale=1.5)
            name = f"page-{index + 1:03}.png"
            bitmap.to_pil().save(output / name)
            bitmap.close()
            page.close()
            names.append(name)
    finally:
        document.close()
    return names


def word_to_pdf(source: Path, output: Path) -> Path:
    """Use a fixed renderer with an isolated profile and a bounded subprocess lifetime."""
    profile = output / "office-profile"
    result = subprocess.run([
        os.environ.get("SOFFICE_BINARY", "soffice"),
        f"-env:UserInstallation={profile.as_uri()}", "--headless", "--nologo", "--nodefault",
        "--nolockcheck", "--convert-to", "pdf", "--outdir", str(output), str(source),
    ], capture_output=True, timeout=60, check=False)
    pdf = output / f"{source.stem}.pdf"
    if result.returncode != 0 or not pdf.is_file():
        raise ValueError("word_render_failed")
    return pdf


def clean_html(text: str, resources: dict[str, str]) -> tuple[str, int]:
    """Remove active content and inline only resources explicitly archived with the submission."""
    import base64
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(text, "html.parser")
    for element in soup.find_all(["script", "iframe", "object", "embed", "base", "link"]):
        element.decompose()
    for element in soup.find_all("meta"):
        if element.get("http-equiv", "").lower() == "refresh":
            element.decompose()
    resource_bytes = 0
    missing = 0
    for image in soup.find_all("img"):
        reference = str(image.get("src", ""))
        if reference in resources:
            path = source_file(resources[reference])
            resource_bytes += path.stat().st_size
            if resource_bytes > MAX_BYTES:
                raise ValueError("resources_too_large")
            with Image.open(path) as loaded:
                buffer = io.BytesIO()
                loaded.convert("RGB").save(buffer, format="PNG")
            image["src"] = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()
        elif not reference.startswith(("data:image/png;", "data:image/jpeg;", "data:image/webp;", "data:image/gif;")):
            missing += 1
            image["src"] = ""
            image["alt"] = str(image.get("alt", "")) + " [未提供图片资源]"
    return str(soup), missing


def render_html(text: str, output: Path, markdown: bool, resources: dict[str, str]) -> tuple[list[str], Path, int]:
    """Render a network-isolated document into a paged PDF and complete page previews."""
    from playwright.sync_api import sync_playwright
    if markdown:
        from markdown_it import MarkdownIt
        text = MarkdownIt("commonmark", {"html": False}).enable("table").render(text)
    html, missing = clean_html(text, resources)
    blocked = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        context = browser.new_context(java_script_enabled=False, reduced_motion="reduce")
        context.route("**/*", lambda route: (blocked.append("external_resource"), route.abort())[-1])
        page = context.new_page()
        style = "html,body{height:auto!important;max-height:none!important;overflow:visible!important}body{font-family:sans-serif;overflow-wrap:anywhere}img{max-width:100%}pre{white-space:pre-wrap}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px}@page{size:A4;margin:14mm}"
        page.set_content(html + "<style>" + style + "</style>", wait_until="load", timeout=30_000)
        pdf = output / "rendered.pdf"
        page.pdf(path=str(pdf), format="A4", print_background=True, prefer_css_page_size=True)
        context.close()
        browser.close()
    previews = render_pdf(pdf, output)
    return previews, pdf, missing + len(blocked)


def parse(request: ParseRequest) -> dict:
    """Publish a manifest only after the archived file and all requested previews are processed."""
    original = source_file(request.storageKey)
    digest = file_hash(original)
    if digest != request.sha256:
        raise ValueError("content_hash_mismatch")
    output = OUTPUT_ROOT / str(request.requestId)
    output.mkdir(parents=True, exist_ok=True)
    resource_hashes = {key: file_hash(source_file(value)) for key, value in request.resources.items()}
    manifest = output / "manifest.json"
    if manifest.is_file():
        existing = json.loads(manifest.read_text())
        if existing["sourceHash"] != digest or existing["parserVersion"] != PARSER_VERSION or existing.get("resourceHashes", {}) != resource_hashes:
            raise ValueError("request_version_conflict")
        if existing["status"] == "complete":
            return existing
    kind = identify(original, request.originalName)
    source = output / f"input.{kind if kind != 'image' else 'png'}"
    shutil.copyfile(original, source)
    missing_resources = 0
    if kind == "text":
        from charset_normalizer import from_bytes
        text = str(from_bytes(source.read_bytes()).best() or "")
        previews, status = [], "complete"
    else:
        if kind in ["doc", "docx"]:
            source = word_to_pdf(source, output)
        if kind in ["html", "markdown"]:
            from charset_normalizer import from_bytes
            raw = str(from_bytes(source.read_bytes()).best() or "")
            previews, source, missing_resources = render_html(raw, output, kind == "markdown", request.resources)
        elif kind == "image":
            with Image.open(original) as image:
                image.convert("RGB").save(source, format="PNG")
            shutil.copyfile(source, output / "page-001.png")
            previews = ["page-001.png"]
        else:
            previews = render_pdf(source, output)
        result = get_converter().convert(source, raises_on_error=False)
        from docling_core.types.doc import ImageRefMode
        text = result.document.export_to_markdown(image_mode=ImageRefMode.PLACEHOLDER)
        status = "complete" if str(result.status.value) == "success" else "partial"
    if not text.strip() or missing_resources:
        status = "needs_review"
    payload = {"parserVersion": PARSER_VERSION, "sourceHash": digest, "format": kind,
               "status": status, "text": text, "pages": len(previews), "previews": previews,
               "coverage": "all_pages" if previews else "text_only", "resourceHashes": resource_hashes,
               "missingResources": missing_resources}
    temporary = output / "manifest.tmp"
    temporary.write_text(json.dumps(payload, ensure_ascii=False))
    temporary.replace(manifest)
    return payload


@app.get("/healthz")
def health():
    """Expose readiness without disclosing storage paths, credentials or candidate content."""
    return {"status": "ready" if len(TOKEN) >= 32 else "unconfigured", "parserVersion": PARSER_VERSION}


@app.post("/parse")
async def parse_file(request: ParseRequest, authorization: str = Header(default="")):
    """Authorize the CRM and serialize model use while allowing queued HTTP requests."""
    if len(TOKEN) < 32 or not secrets.compare_digest(authorization, "Bearer " + TOKEN):
        raise HTTPException(status_code=401, detail="unauthorized")
    try:
        async with parse_lock:
            return await asyncio.to_thread(parse, request)
    except (ValueError, zipfile.BadZipFile) as error:
        raise HTTPException(status_code=422, detail=str(error)[:100]) from None
    except Exception:
        logger.exception("Parser operation failed")
        raise HTTPException(status_code=422, detail="parser_failed") from None
