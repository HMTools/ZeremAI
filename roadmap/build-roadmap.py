#!/usr/bin/env python3
"""Generate site/roadmap.mdx from roadmap/items and roadmap/archive. Run from anywhere: python3 roadmap/build-roadmap.py"""
import json, re
from pathlib import Path

root = Path(__file__).parent
load = lambda d: [json.loads(f.read_text()) for f in sorted((root / d).glob("*.json"))]
items, archive = load("items"), load("archive")
PRIO = {"high": 0, "medium": 1, "low": 2}
CATS = {"framework": "Framework (plugin)", "ui": "Flow pane (UI)", "server": "Server"}
BADGE = {"high": "🔴 High", "medium": "🟡 Medium", "low": "⚪ Low"}


def esc(text):
    """Make text MDX-safe: leave `code` spans alone, escape braces and angle brackets elsewhere."""
    parts = re.split(r"(`[^`]*`)", text.strip())
    return "".join(p if p.startswith("`") else p.replace("{", "\\{").replace("}", "\\}").replace("<", "&lt;").replace(">", "&gt;") for p in parts)


def card(i, done=False):
    meta = " · ".join(filter(None, [i["id"], i["type"], "" if done else BADGE.get(i["priority"], ""), i.get("effort") or ""]))
    body = [f"*{meta}*", "", esc(i["description"])]
    if i.get("notes"):
        body += ["", f"**Notes:** {esc(i['notes'])}"]
    if i.get("acceptance_criteria"):
        body += ["", "**Acceptance criteria**", ""] + [f"- {esc(a)}" for a in i["acceptance_criteria"]]
    title = esc(i["title"]).replace('"', "'")
    return f'<Accordion title="{title}">\n' + "\n".join(body) + "\n</Accordion>"


out = ['---', 'title: "Roadmap"', 'description: "What is planned and what has shipped for ZeremAI."', '---', '',
       "Ideas and planned work for ZeremAI, the Claude Code plugin, grouped by area and sorted by priority. Nothing here is a commitment or has a date. Open an [issue](https://github.com/HMTools/ZeremAI/issues) to suggest something.", '',
       f"**{len(items)}** planned · **{sum(i['status'] == 'done' for i in archive)}** shipped", '']
for cat, label in CATS.items():
    group = sorted((i for i in items if i["category"] == cat), key=lambda i: (PRIO.get(i["priority"], 9), i["id"]))
    if group:
        out += [f"## {label}", "", "<AccordionGroup>", *[card(i) + "\n" for i in group], "</AccordionGroup>", ""]
done = sorted((i for i in archive if i["status"] == "done"), key=lambda i: i["id"])
if done:
    out += ["## Shipped", "", "<AccordionGroup>", *[card(i, True) + "\n" for i in done], "</AccordionGroup>", ""]
(root.parent / "site" / "roadmap.mdx").write_text("\n".join(out))
print(f"wrote site/roadmap.mdx: {len(items)} planned, {len(done)} shipped")
