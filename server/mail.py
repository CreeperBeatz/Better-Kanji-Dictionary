"""Sending the sign-in email.

Two senders behind one function. With `RESEND_API_KEY` set, mail goes out
through Resend; without it, the link is printed to the server log and handed
back to the browser so sign-in works with no mail setup at all.

    RESEND_API_KEY   turns on real sending
    MAIL_FROM        the From address; must be on a domain verified in Resend
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

RESEND_URL = "https://api.resend.com/emails"


def is_dev() -> bool:
    """True when no real sender is configured, so links are shown, not mailed."""
    return not os.environ.get("RESEND_API_KEY")


LANGS = ("en", "bg")


def send_magic_link(email: str, link: str, lang: str = "en") -> None:
    """The sign-in email, in the language the interface was in when it was asked for."""
    if is_dev():
        print(f"[mail] sign-in link for {email}: {link}", flush=True)
        return
    if lang == "bg":
        subject = "Вход в Better Kanji Dictionary"
        text = (
            "Отворете тази връзка, за да влезете в Better Kanji Dictionary:\n\n"
            f"{link}\n\n"
            "Връзката работи веднъж и изтича след 15 минути. Ако не сте я поискали, не обръщайте внимание на този имейл."
        )
    else:
        subject = "Sign in to Better Kanji Dictionary"
        text = (
            "Open this link to sign in to Better Kanji Dictionary:\n\n"
            f"{link}\n\n"
            "It works once and expires in 15 minutes. If you did not ask for it, ignore this email."
        )
    _send_resend(to=email, subject=subject, text=text)


def _send_resend(to: str, subject: str, text: str) -> None:
    body = json.dumps({
        "from": os.environ.get("MAIL_FROM", "Better Kanji Dictionary <login@example.com>"),
        "to": [to],
        "subject": subject,
        "text": text,
    }).encode("utf-8")
    req = urllib.request.Request(
        RESEND_URL,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {os.environ['RESEND_API_KEY']}",
            "Content-Type": "application/json",
            # Resend sits behind Cloudflare, which rejects urllib's default agent (error 1010).
            "User-Agent": "BetterRTK/0.1",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            res.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Resend refused the email: {e.code} {e.read().decode('utf-8', 'replace')}")
