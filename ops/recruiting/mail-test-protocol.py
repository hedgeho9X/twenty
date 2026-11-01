"""Exercises the dedicated loopback SMTP/IMAP server independently from Twenty's mail client."""
import hashlib
import imaplib
import json
import smtplib
import sys
from datetime import datetime, timezone
from email import policy
from email.message import EmailMessage
from email.utils import format_datetime
from pathlib import Path


def message(account: dict, state: dict, old: bool) -> EmailMessage:
    """Builds only synthetic MIME; complete text, HTML, PDF and inline content remain in the local service."""
    mail = EmailMessage(policy=policy.SMTP)
    mail["From"] = "synthetic-sender@recruiting.local.invalid"
    mail["To"] = account["handle"]
    mail["Date"] = format_datetime(datetime.now(timezone.utc))
    mail["Message-ID"] = state["oldMessageId" if old else "newMessageId"]
    mail["Subject"] = "本地历史基线邮件" if old else "本地合成简历实收验收"
    if old:
        mail.set_content("OLD_BASELINE_ONLY：开启接入前的邮件，不应进入新邮件队列。")
        return mail
    mail.set_content(
        "这是本地邮件链路的合成材料。\n"
        "本次求职意向：后端工程师，接受全职远程。简历见PDF附件。\n"
        "仅用于本地验证，请勿实际联系、推荐或发布。\n"
        "> ORIGINAL_QUOTED_BLOCK：这段历史引用也应完整归档。\n"
    )
    mail.add_alternative(
        '<html><body><p>本次求职意向：后端工程师，接受全职远程。</p>'
        '<blockquote>ORIGINAL_QUOTED_BLOCK：保留历史引用。</blockquote>'
        '<img src="cid:signature@recruiting.local.invalid"></body></html>',
        subtype="html",
    )
    mail.get_payload()[1].add_related(
        bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082"),
        maintype="image", subtype="png", filename="signature.png",
        cid="<signature@recruiting.local.invalid>", disposition="inline",
    )
    mail.add_attachment(Path(state["pdfPath"]).read_bytes(), maintype="application", subtype="pdf", filename="local-synthetic-resume.pdf")
    return mail


def connect(account: dict) -> imaplib.IMAP4:
    """Authenticates only to the guarded local test port; the caller owns this synthetic mailbox."""
    client = imaplib.IMAP4("127.0.0.1", 23143, timeout=15)
    client.login(account["username"], account["password"])
    return client


def uids(client: imaplib.IMAP4, identifier: str) -> list[str]:
    """Returns message identities without fetching or mutating any mail flags."""
    status, data = client.uid("search", None, "HEADER", "Message-ID", identifier)
    assert status == "OK"
    return data[0].decode().split() if data[0] else []


def run(action: str, account: dict, state: dict) -> dict:
    """Sends a missing fixture once, snapshots PEEK bytes, or appends an exact duplicate for receiver dedupe."""
    assert account["host"] == "127.0.0.1" and account["smtpPort"] == 23025 and account["imapPort"] == 23143
    assert account["handle"] == "recruiting-harness@recruiting.local.invalid"
    client = connect(account)
    try:
        client.select("INBOX", readonly=True)
        identifier = state["oldMessageId" if action == "seed-old" else "newMessageId"]
        found = uids(client, identifier)
        if action in ("seed-old", "send-new") and not found:
            mail = message(account, state, action == "seed-old")
            with smtplib.SMTP("127.0.0.1", 23025, timeout=15) as smtp:
                smtp.login(account["username"], account["password"])
                smtp.send_message(mail)
            found = uids(client, identifier)
        assert found, "Fixture not present in local IMAP mailbox"
        if action == "append-copy":
            if len(found) < 2:
                raw = Path(state["serverRawPath"]).read_bytes()
                status, _ = client.append("INBOX", None, None, raw)
                assert status == "OK"
            found = uids(client, identifier)
            assert len(found) == 2
        result = {"uids": [int(uid) for uid in found]}
        if action in ("snapshot", "send-new"):
            status, data = client.uid("fetch", found[0], "(UID FLAGS BODY.PEEK[])")
            assert status == "OK"
            literal = next(item for item in data if isinstance(item, tuple))
            raw = literal[1]
            Path(state["serverRawPath"]).write_bytes(raw)
            Path(state["serverRawPath"]).chmod(0o600)
            result.update({"rawSha256": hashlib.sha256(raw).hexdigest(), "rawBytes": len(raw), "seen": b"\\Seen" in literal[0]})
        return result
    finally:
        client.logout()


try:
    payload = json.load(sys.stdin)
    print(json.dumps(run(sys.argv[1], payload["account"], payload["state"])))
except Exception as error:
    print(json.dumps({"errorType": type(error).__name__}), file=sys.stderr)
    sys.exit(1)
