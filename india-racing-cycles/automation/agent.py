#!/usr/bin/env python3
"""Daily public-source collector for India Racing Cycles.

Without GEMINI_API_KEY this safely refreshes relevant Google News RSS headlines
and archives expired events. With a key, it also asks Gemini to extract event
candidates from configured public source pages. Restricted social platforms
are intentionally not scraped.
"""
from __future__ import annotations
import hashlib
import json
import os
import re
import sys
from datetime import datetime, date
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import feedparser
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SOURCE_FILE = ROOT / "automation" / "sources.json"
USER_AGENT = "IndiaRacingCyclesBot/1.0 (+https://learndhairyash.github.io/india-racing-cycles/)"
TODAY = datetime.now(ZoneInfo("Asia/Kolkata")).date()
HEADERS = {"User-Agent": USER_AGENT, "Accept": "text/html,application/xml,application/rss+xml"}
KEYWORDS = ("cycling", "cyclist", "cyclothon", "mtb", "bicycle", "road race", "gran fondo", "velodrome")


def read_json(path: Path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def canonical_url(url: str) -> str:
    return (url or "").split("#", 1)[0].rstrip("/")


def stable_id(value: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    return (base[:64] or "cycling-update") + "-" + hashlib.sha1(value.encode("utf-8")).hexdigest()[:7]


def fetch_source_pages(sources):
    documents = []
    for source in sources:
        url = source.get("url", "")
        try:
            response = requests.get(url, headers=HEADERS, timeout=20)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, "html.parser")
            for tag in soup(["script", "style", "noscript", "svg", "nav", "footer"]):
                tag.decompose()
            text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True))
            if text:
                documents.append({
                    "name": source.get("name", url),
                    "url": url,
                    "kind": source.get("kind", "publisher"),
                    "text": text[:14000]
                })
                print(f"Fetched source: {source.get('name', url)} ({len(text)} chars)")
        except Exception as exc:
            print(f"Source unavailable: {url}: {exc}")
    return documents


def rss_news(feeds):
    seen = set()
    results = []
    for feed in feeds:
        try:
            parsed = feedparser.parse(feed["url"])
            for entry in parsed.entries[:40]:
                title = (entry.get("title") or "").strip()
                summary = BeautifulSoup(entry.get("summary", ""), "html.parser").get_text(" ", strip=True)
                combined = (title + " " + summary).lower()
                if not title or not any(k in combined for k in KEYWORDS):
                    continue
                link = canonical_url(entry.get("link", ""))
                if not link or link in seen:
                    continue
                seen.add(link)
                published = entry.get("published_parsed") or entry.get("updated_parsed")
                if published:
                    published_at = datetime(*published[:6]).date().isoformat()
                else:
                    published_at = TODAY.isoformat()
                publisher = (entry.get("source") or {}).get("title") or feed.get("name", "Public news feed")
                kind = "results" if "result" in combined or "winner" in combined else ("announcement" if "announce" in combined or "register" in combined else "race")
                results.append({
                    "id": stable_id(title + link),
                    "title": title,
                    "published_at": published_at,
                    "publisher": publisher,
                    "category": "India cycling",
                    "type": kind,
                    "summary": summary[:420] or "Open the original link for the full report.",
                    "source_url": link,
                    "verified_at": TODAY.isoformat(),
                    "discovery_source": feed.get("name", "RSS")
                })
        except Exception as exc:
            print(f"RSS unavailable: {feed.get('url')}: {exc}")
    return results


def gemini_extract(documents, current_events):
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        print("GEMINI_API_KEY not configured; AI page extraction is skipped. RSS discovery and date archiving still run.")
        return []
    if not documents:
        return []
    import requests as http
    prompt = {
        "task": "Extract verifiable Indian cycling event updates from these public source pages.",
        "rules": [
            "Return only facts explicitly present in the supplied source text.",
            "Never guess a date, location, category, organiser, registration URL, contact or poster URL.",
            "Every candidate must cite one exact source_url from the supplied documents and include a short evidence_quote copied from that source.",
            "Only classify a source as official when its kind is official in the supplied input.",
            "For a new event, require a title and ISO start_date. If an end date is absent, use the same date only when the source clearly describes a one-day event; otherwise return an empty end_date.",
            "For changes to an existing event, return its matching id and only the changed fields. Do not infer a cancellation from absence of a listing.",
            "Use status confirmed, postponed, cancelled or completed only when the source explicitly supports it.",
            "Return confidence between 0 and 1. Low-confidence or conflicting facts must remain review candidates.",
            "Return valid JSON only, with an object containing candidates array."
        ],
        "existing_events": current_events[:100],
        "source_documents": documents
    }
    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    response = http.post(url, params={"key": key}, json={
        "contents": [{"parts": [{"text": json.dumps(prompt, ensure_ascii=False)}]}],
        "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"}
    }, timeout=90)
    response.raise_for_status()
    payload = response.json()
    text = payload["candidates"][0]["content"]["parts"][0]["text"]
    parsed = json.loads(text)
    return parsed.get("candidates", [])


def domain_is_official(url, approved):
    host = (urlparse(url).hostname or "").lower()
    return any(host == d or host.endswith("." + d) for d in approved)


def valid_candidate(item, known_sources):
    source_url = canonical_url(item.get("source_url", ""))
    matched = next((s for s in known_sources if canonical_url(s.get("url", "")) == source_url), None)
    if not matched:
        return False
    if not item.get("title") or not item.get("evidence_quote"):
        return False
    try:
        start = date.fromisoformat(item.get("start_date", ""))
        end_value = item.get("end_date")
        if end_value and date.fromisoformat(end_value) < start:
            return False
    except ValueError:
        return False
    return True


def main():
    config = read_json(SOURCE_FILE, {})
    events_doc = read_json(DATA / "events.json", {"meta": {}, "events": []})
    news_doc = read_json(DATA / "news.json", {"meta": {}, "news": []})
    review_doc = read_json(DATA / "review-queue.json", {"items": []})
    events = events_doc.get("events", [])
    news = news_doc.get("news", [])

    pages = fetch_source_pages(config.get("source_pages", []))
    discovered_news = rss_news(config.get("rss_feeds", []))
    seen_links = {canonical_url(n.get("source_url", "")) for n in news}
    added_news = 0
    for item in discovered_news:
        if canonical_url(item["source_url"]) not in seen_links:
            news.append(item)
            seen_links.add(canonical_url(item["source_url"]))
            added_news += 1
    news.sort(key=lambda x: x.get("published_at", ""), reverse=True)
    news = news[:100]

    candidates = gemini_extract(pages, events)
    approved = config.get("approved_official_domains", [])
    review_items = review_doc.get("items", [])
    for candidate in candidates:
        if not valid_candidate(candidate, config.get("source_pages", [])):
            review_items.append({"received_at": TODAY.isoformat(), "reason": "Missing/invalid evidence or unconfigured source URL", "candidate": candidate})
            continue
        source = next(s for s in config["source_pages"] if canonical_url(s["url"]) == canonical_url(candidate["source_url"]))
        official = source.get("kind") == "official" and domain_is_official(candidate["source_url"], approved)
        confidence = float(candidate.get("confidence") or 0)
        evidence = str(candidate.get("evidence_quote") or "")
        status = candidate.get("status", "confirmed")
        if not official or confidence < 0.9 or len(evidence) < 15:
            review_items.append({"received_at": TODAY.isoformat(), "reason": "Needs human verification (non-official source or confidence/evidence threshold)", "candidate": candidate})
            continue
        existing = next((e for e in events if e.get("id") == candidate.get("id") or (e.get("title","").lower() == candidate.get("title","").lower() and e.get("start_date") == candidate.get("start_date"))), None)
        clean = {k: candidate[k] for k in ("title","start_date","end_date","location","state","discipline","categories","organiser","description","registration_url","contact_email","contact_phone","poster_url","status") if k in candidate}
        clean.update({"source_url": candidate["source_url"], "verified_at": TODAY.isoformat(), "confidence": "high", "evidence_quote": evidence, "source_name": source["name"]})
        if existing:
            # Only update explicit fields; a status/date change still requires clear evidence from an official source.
            existing.update(clean)
            existing["last_change_source"] = candidate["source_url"]
        elif status in ("confirmed", "postponed") and confidence >= 0.95 and clean.get("start_date"):
            clean["id"] = candidate.get("id") or stable_id(clean["title"] + clean["start_date"])
            events.append(clean)
        else:
            review_items.append({"received_at": TODAY.isoformat(), "reason": "New event does not meet the publication confidence threshold", "candidate": candidate})

    # Move completed events to the archive state on the day after their final date.
    for event in events:
        end_value = event.get("end_date")
        try:
            # Do not guess the finish date for multi-day/ultra events.
            if end_value and date.fromisoformat(end_value) < TODAY and event.get("status") not in ("cancelled", "postponed"):
                event["status"] = "completed"
        except (TypeError, ValueError):
            continue

    # Keep the latest review records, but never silently discard pending items.
    review_doc = {"meta": {"last_updated": TODAY.isoformat()}, "items": review_items[-500:]}
    events_doc["events"] = events
    events_doc["meta"] = {**events_doc.get("meta", {}), "last_updated": TODAY.isoformat(), "automation_last_run": datetime.now(ZoneInfo("Asia/Kolkata")).isoformat()}
    news_doc["news"] = news
    news_doc["meta"] = {**news_doc.get("meta", {}), "last_updated": TODAY.isoformat(), "automation_last_run": datetime.now(ZoneInfo("Asia/Kolkata")).isoformat()}
    write_json(DATA / "events.json", events_doc)
    write_json(DATA / "news.json", news_doc)
    write_json(DATA / "review-queue.json", review_doc)
    print(f"Daily collection complete. Fetched {len(pages)} source pages, discovered {len(discovered_news)} RSS items, added {added_news} news entries, processed {len(candidates)} AI candidates, and retained {len(review_items)} review items.")


if __name__ == "__main__":
    main()