"""Converts a prepared PDF or image through MinerU, preserving its remote task across retries."""
import io
import json
import time
import zipfile
from pathlib import Path
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

API = "https://mineru.net/api/v4"
MAX_RESULT_BYTES = 100 * 1024 * 1024
MAX_MARKDOWN_BYTES = 4 * 1024 * 1024


class NoRedirect(HTTPRedirectHandler):
    """Keep credentials and document bytes on the endpoint selected for each request."""

    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


def download(url: str, limit: int, **kwargs) -> bytes:
    """Read a bounded response and require HTTPS for every outbound request."""
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("mineru_invalid_url")
    with build_opener(NoRedirect()).open(Request(url, **kwargs), timeout=30) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError("mineru_response_too_large")
    return data


def extract(source: Path, output: Path, token: str) -> str:
    """Upload once per batch, resume polling after a timeout, and extract only full.md."""
    headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}

    def api(path: str, body: dict | None = None) -> dict:
        payload = json.loads(download(
            API + path, 1024 * 1024, headers=headers,
            data=json.dumps(body).encode() if body is not None else None,
        ))
        if payload.get("code") != 0:
            raise ValueError("mineru_request_failed")
        return payload["data"]

    checkpoint = output / "mineru-batch.json"
    if checkpoint.is_file():
        batch_id = json.loads(checkpoint.read_text())["batch_id"]
    else:
        batch = api("/file-urls/batch", {
            "model_version": "vlm",
            "files": [{"name": source.name}],
        })
        batch_id = batch["batch_id"]
        # urllib otherwise adds a form content type, which invalidates the presigned PUT.
        download(
            batch["file_urls"][0], 1024 * 1024, method="PUT",
            headers={"Content-Type": ""}, data=source.read_bytes(),
        )
        temporary = checkpoint.with_suffix(".tmp")
        temporary.write_text(json.dumps({"batch_id": batch_id}))
        temporary.replace(checkpoint)

    deadline = time.monotonic() + 230
    while time.monotonic() < deadline:
        data = api("/extract-results/batch/" + quote(batch_id, safe=""))
        results = data["extract_result"]
        if results:
            result = results[0]
            if result["state"] == "failed":
                checkpoint.unlink(missing_ok=True)
                raise ValueError("mineru_extract_failed")
            if result["state"] == "done":
                archive = download(result["full_zip_url"], MAX_RESULT_BYTES)
                with zipfile.ZipFile(io.BytesIO(archive)) as parsed:
                    files = [item for item in parsed.infolist() if Path(item.filename).name == "full.md"]
                    if len(files) != 1 or files[0].file_size > MAX_MARKDOWN_BYTES:
                        raise ValueError("mineru_markdown_unavailable")
                    with parsed.open(files[0]) as stream:
                        return stream.read(MAX_MARKDOWN_BYTES + 1).decode("utf-8-sig")
        time.sleep(2)
    raise ValueError("mineru_extract_pending")
