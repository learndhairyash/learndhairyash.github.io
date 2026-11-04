#!/usr/bin/env python3
"""Build a monthly operations summary for India Racing Cycles."""
import json
import os
from datetime import datetime, date, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/"data"
REPORTS=ROOT/"reports"
NOW=datetime.now(ZoneInfo("Asia/Kolkata"))
TODAY=NOW.date()

def load(name, default):
    try:
        return json.loads((DATA/name).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default

def previous_month(day):
    first=day.replace(day=1)
    last_prev=first-timedelta(days=1)
    return last_prev.strftime("%Y-%m"), last_prev.replace(day=1), last_prev

def main():
    period,start,end=previous_month(TODAY)
    events=load("events.json",{}).get("events",[])
    news=load("news.json",{}).get("news",[])
    review=load("review-queue.json",{}).get("items",[])
    upcoming=[e for e in events if e.get("start_date","")>=TODAY.isoformat() and e.get("status") not in ("cancelled","completed")]
    completed=[e for e in events if e.get("status")=="completed" or (e.get("end_date") and e.get("end_date")<TODAY.isoformat())]
    cancelled=[e for e in events if e.get("status")=="cancelled"]
    postponed=[e for e in events if e.get("status")=="postponed"]
    period_news=[n for n in news if start.isoformat()<=n.get("published_at","")<=end.isoformat()]
    sources=load("sources.json",{})
    ai_enabled=bool(os.environ.get("GEMINI_API_KEY"))
    generated=NOW.strftime("%Y-%m-%d %H:%M IST")
    lines=[
        f"# India Racing Cycles — monthly report ({period})",
        "",
        f"Generated: {generated}",
        "",
        "## Calendar health",
        f"- Total event records: **{len(events)}**",
        f"- Upcoming events: **{len(upcoming)}**",
        f"- Past/completed events: **{len(completed)}**",
        f"- Cancelled events: **{len(cancelled)}**",
        f"- Postponed events: **{len(postponed)}**",
        "",
        "## News and discovery",
        f"- News records published during {period}: **{len(period_news)}**",
        f"- Configured public source pages: **{len(sources.get('source_pages',[]))}**",
        f"- RSS discovery feeds: **{len(sources.get('rss_feeds',[]))}**",
        f"- Gemini page extraction: **{'Enabled (key present)' if ai_enabled else 'Not configured — RSS-only mode'}**",
        "",
        "## Items needing review",
        f"- Pending review queue: **{len(review)}**",
    ]
    if review:
        lines += ["", "| Reason | Candidate | Source |", "|---|---|---|"]
        for item in review[:30]:
            candidate=item.get("candidate",{})
            title=str(candidate.get("title","Untitled candidate")).replace("|","/")
            source=str(candidate.get("source_url","")).replace("|","/")
            reason=str(item.get("reason","Needs review")).replace("|","/")
            lines.append(f"| {reason} | {title} | {source} |")
        if len(review)>30:
            lines.append(f"_And {len(review)-30} more item(s) in data/review-queue.json._")
    else:
        lines += ["", "No items are currently waiting in the review queue."]
    lines += [
        "",
        "## Operating notes",
        "- Confirm event dates, venues and entry rules on the organiser's website before publishing travel or payment advice.",
        "- Facebook Groups, most Instagram posts and LinkedIn posts are not unrestricted data sources. This collector does not bypass login or access controls.",
        "- Newsletter delivery remains dependent on the Cloudflare Worker, a verified sender domain and configured Resend credentials.",
        "- This report is a system summary, not a guarantee that every cycling event in India has been discovered.",
        ""
    ]
    REPORTS.mkdir(parents=True,exist_ok=True)
    content="\n".join(lines)
    (REPORTS/f"{period}.md").write_text(content,encoding="utf-8")
    (REPORTS/"latest-monthly-report.md").write_text(content,encoding="utf-8")
    print(f"Created monthly report for {period}.")

if __name__=="__main__":
    main()
