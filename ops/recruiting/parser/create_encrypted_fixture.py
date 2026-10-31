"""Encrypt and independently reopen the synthetic two-page PDF to distinguish password failure from corruption."""
import sys
from pathlib import Path
from pypdf import PdfReader, PdfWriter

root = Path(sys.argv[1])
writer = PdfWriter(clone_from=root / 'scan-chinese.pdf')
writer.encrypt('synthetic-fixture-password', algorithm='AES-256')
writer.write(root / 'encrypted.pdf')
reader = PdfReader(root / 'encrypted.pdf')
assert reader.is_encrypted
assert reader.decrypt('synthetic-fixture-password')
assert len(reader.pages) == 2
print({'encrypted': True, 'passwordVerified': True, 'pages': len(reader.pages)})
