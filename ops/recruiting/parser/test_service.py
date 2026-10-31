"""Verify intake material isolation, authenticated parsing and safe document rendering."""
import hashlib
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

spec = importlib.util.spec_from_file_location("recruiting_parser", Path(__file__).with_name("service.py"))
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)


class MaterialParsingTests(unittest.TestCase):
    """Use synthetic files only; model inference is covered separately with real fixtures."""

    def setUp(self):
        """Give each test isolated source/output roots and a synthetic server credential."""
        self.temporary = tempfile.TemporaryDirectory(prefix="recruiting-parser-test-")
        self.root = Path(self.temporary.name).resolve()
        service.INPUT_ROOT = self.root / "input"
        service.OUTPUT_ROOT = self.root / "output"
        service.INPUT_ROOT.mkdir()
        service.OUTPUT_ROOT.mkdir()
        service.TOKEN = "synthetic-test-credential-" + "x" * 32
        self.client = TestClient(service.app)
        self.headers = {"Authorization": "Bearer " + service.TOKEN}

    def tearDown(self):
        """Discard only the test's own temporary material."""
        self.client.close()
        self.temporary.cleanup()

    def request(self, content=b"Synthetic TypeScript backend resume", name="resume.txt"):
        """Create a declared material version with an exact content hash."""
        (service.INPUT_ROOT / "material").write_bytes(content)
        return {"requestId": str(uuid4()), "storageKey": "material", "originalName": name,
                "sha256": hashlib.sha256(content).hexdigest()}

    def test_unauthorized_request_is_rejected(self):
        """A valid material path does not grant access without the CRM credential."""
        response = self.client.post("/parse", json=self.request())
        self.assertEqual(response.status_code, 401)
        self.assertEqual(list(service.OUTPUT_ROOT.iterdir()), [])

    def test_text_is_preserved_and_completed_retry_is_idempotent(self):
        """Adjacent contact and career text survives rather than being removed as a line."""
        content = "联系方式：test@example.invalid；三年 TypeScript 后端经验\n意向：全职后端岗位".encode()
        request = self.request(content)
        first = self.client.post("/parse", json=request, headers=self.headers)
        self.assertEqual(first.status_code, 200)
        self.assertIn("三年 TypeScript 后端经验", first.json()["text"])
        self.assertEqual(first.json()["status"], "complete")
        self.assertEqual(first.json(), self.client.post("/parse", json=request, headers=self.headers).json())

    def test_traversal_cannot_read_a_sibling_file(self):
        """Even an existing path outside the archive is refused before content access."""
        request = self.request()
        (self.root / "outside.txt").write_text("outside-sentinel")
        request["storageKey"] = "../outside.txt"
        response = self.client.post("/parse", json=request, headers=self.headers)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "invalid_storage_key")

    def test_hash_mismatch_is_not_published(self):
        """A changed source cannot reuse a prior material declaration."""
        request = self.request()
        request["sha256"] = "0" * 64
        response = self.client.post("/parse", json=request, headers=self.headers)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "content_hash_mismatch")
        self.assertEqual(list(service.OUTPUT_ROOT.iterdir()), [])

    def test_uploaded_html_cannot_keep_active_content_or_fetch_images(self):
        """Network resources are explicit missing inputs; scripts and embedded pages are removed."""
        html, missing = service.clean_html('<script>fetch("https://example.invalid")</script>'
            '<iframe src="file:///private/file"></iframe><img src="https://example.invalid/resume.png">', {})
        self.assertNotIn("<script", html)
        self.assertNotIn("<iframe", html)
        self.assertNotIn('src="https://', html)
        self.assertEqual(missing, 1)

    def test_long_markdown_has_complete_page_previews(self):
        """Exercise real browser/PDF rendering without requiring the OCR model."""
        text = "# Synthetic resume\n\n" + "TypeScript backend experience and project evidence.\n\n" * 180
        previews, pdf, missing = service.render_html(text, service.OUTPUT_ROOT, True, {})
        self.assertGreater(len(previews), 1)
        self.assertTrue(pdf.is_file())
        self.assertTrue(all((service.OUTPUT_ROOT / name).is_file() for name in previews))
        self.assertEqual(missing, 0)


if __name__ == "__main__":
    unittest.main()
