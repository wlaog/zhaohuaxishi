"""Read-only DOCX to HTML preparation. Preserve embedded media bytes and OOXML text.

Uses Python's standard library; never launches Word or modifies a source document.
Output is private import staging, not a replacement DOCX.
"""
import argparse
import hashlib
import html
import json
import posixpath
from pathlib import Path
import zipfile
import xml.etree.ElementTree as ET

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "v": "urn:schemas-microsoft-com:vml",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
}

def q(name):
    prefix, local = name.split(":")
    return "{" + NS[prefix] + "}" + local

def attr(node, name, fallback=None):
    return node.get(q(name), fallback) if node is not None else fallback

def convert(source, project, output):
    relative = source.relative_to(project).as_posix()
    key = hashlib.sha256(relative.encode()).hexdigest()[:16]
    stage = output / key
    stage.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(source) as archive:
        document = ET.fromstring(archive.read("word/document.xml"))
        relationships = ET.fromstring(archive.read("word/_rels/document.xml.rels"))
        rels = {r.get("Id"): r for r in relationships}
        images = []
        for name in archive.namelist():
            if not name.startswith("word/media/") or name.endswith("/"):
                continue
            data = archive.read(name)
            filename = "original-media/" + name[len("word/media/"):]
            target = (stage / filename).resolve()
            if not target.is_relative_to(stage.resolve()):
                raise ValueError("Unsafe media path")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            images.append({"part": name, "file": filename, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        image_files = {image["part"]: image["file"] for image in images}
        used_images = []

        def run_style(run):
            props = run.find("w:rPr", NS)
            if props is None:
                return ""
            styles = []
            for tag, css in [("b", "font-weight:bold"), ("i", "font-style:italic"), ("strike", "text-decoration:line-through")]:
                element = props.find("w:" + tag, NS)
                if element is not None and attr(element, "w:val", "true") not in ("0", "false", "off"):
                    styles.append(css)
            underline = props.find("w:u", NS)
            if underline is not None and attr(underline, "w:val", "single") != "none":
                styles.append("text-decoration:underline")
            size = attr(props.find("w:sz", NS), "w:val")
            if size:
                styles.append(f"font-size:{int(size)/2:g}pt")
            color = attr(props.find("w:color", NS), "w:val")
            if color and len(color) == 6 and all(c in "0123456789abcdefABCDEF" for c in color):
                styles.append("color:#" + color)
            fonts = props.find("w:rFonts", NS)
            font = attr(fonts, "w:eastAsia") or attr(fonts, "w:ascii")
            if font:
                styles.append("font-family:'" + font.replace("'", "") + "'")
            return ";".join(styles)

        def render_run(run):
            parts = []
            for element in run.iter():
                if element.tag == q("w:t"):
                    parts.append(html.escape(element.text or ""))
                elif element.tag == q("w:tab"):
                    parts.append("&#9;")
                elif element.tag in (q("w:br"), q("w:cr")):
                    parts.append("<br>")
                elif element.tag in (q("a:blip"), q("v:imagedata")):
                    relationship = rels.get(attr(element, "r:embed") or attr(element, "r:id"))
                    if relationship is None or relationship.get("TargetMode") == "External":
                        raise ValueError("Missing or external Word image relationship")
                    part = posixpath.normpath("word/" + relationship.get("Target"))
                    if part not in image_files:
                        raise ValueError("Missing embedded Word image: " + part)
                    used_images.append(part)
                    parts.append('<img src="' + html.escape(image_files[part], quote=True) + '" alt="文档原图">')
            return '<span style="' + html.escape(run_style(run), quote=True) + '">' + "".join(parts) + "</span>"

        def render_paragraph(paragraph):
            styles = ["white-space:pre-wrap"]
            props = paragraph.find("w:pPr", NS)
            if props is not None:
                align = attr(props.find("w:jc", NS), "w:val")
                if align in ("left", "center", "right", "both"):
                    styles.append("text-align:" + ("justify" if align == "both" else align))
                spacing = props.find("w:spacing", NS)
                for key, css in [("before", "margin-top"), ("after", "margin-bottom")]:
                    value = attr(spacing, "w:" + key)
                    if value:
                        styles.append(f"{css}:{int(value)/20:g}pt")
            content = []
            for child in paragraph:
                if child.tag == q("w:r"):
                    content.append(render_run(child))
                elif child.tag == q("w:hyperlink"):
                    # Keep link text, without introducing remote requests.
                    content.extend(render_run(run) for run in child.findall("w:r", NS))
            return '<p style="' + html.escape(";".join(styles), quote=True) + '">' + ("".join(content) or "<br>") + "</p>"

        def render_table(table):
            return '<table><tbody>' + ''.join('<tr>' + ''.join('<td>' + ''.join(render_paragraph(p) for p in cell.findall('w:p', NS)) + '</td>' for cell in row.findall('w:tc', NS)) + '</tr>' for row in table.findall('w:tr', NS)) + '</tbody></table>'

        body = document.find("w:body", NS)
        markup = "".join(render_paragraph(element) if element.tag == q("w:p") else render_table(element) if element.tag == q("w:tbl") else "" for element in body)
        texts = [element.text or "" for element in document.iter(q("w:t"))]
        parsed = ET.fromstring("<root>" + markup.replace("<br>", "<br/>").replace('alt="文档原图">', 'alt="文档原图"/>') + "</root>")
        if "".join(texts).replace(" ", "") not in "".join(parsed.itertext()).replace(" ", "").replace("\t", ""):
            raise ValueError("Word preview text does not cover source runs")
        view = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>' + html.escape(source.stem) + '</title><style>body{font:12pt/1.8 "Microsoft YaHei",serif;margin:24px;overflow-wrap:anywhere}p{margin:0 0 8pt}img{max-width:100%;height:auto;vertical-align:middle}table{border-collapse:collapse}td{border:1px solid #ddd;padding:8px}</style><body>' + markup + '</body></html>'
        (stage / "view.html").write_text(view, encoding="utf-8")
        record = {"source": relative, "sourceHash": hashlib.sha256(source.read_bytes()).hexdigest(), "key": key, "view": "view.html", "images": images, "texts": texts, "imageReferences": used_images, "converter": "ooxml-readonly-v1"}
        (stage / "conversion.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"source": relative, "key": key, "images": len(images), "textRuns": len(texts)}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", default=str(Path(__file__).resolve().parent.parent))
    parser.add_argument("--output", default="qa-output/import/word")
    parser.add_argument("roots", nargs="*", default=["imports"])
    args = parser.parse_args()
    project = Path(args.project).resolve()
    output = (project / args.output).resolve()
    if not output.is_relative_to(project):
        raise ValueError("Output must stay inside project")
    results = []
    for root in args.roots:
        directory = (project / root).resolve()
        if not directory.is_relative_to(project):
            raise ValueError("Input must stay inside project")
        for source in sorted(directory.rglob("*.docx")):
            results.append(convert(source, project, output))
            print("Prepared Word import", len(results), flush=True)
    output.mkdir(parents=True, exist_ok=True)
    (output / "report.json").write_text(json.dumps({"conversions": results}, ensure_ascii=False, indent=2), encoding="utf-8")
