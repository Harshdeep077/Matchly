import io, re
import numpy as np
import fitz
from PIL import Image, ImageOps, ImageFilter

VOCAB = ["Python","Java","JavaScript","TypeScript","React","Node.js","FastAPI","Flask","Django","SQL","MySQL",
 "PostgreSQL","MongoDB","HTML","CSS","Git","Docker","AWS","Linux","REST","C++","C#","Machine Learning",
 "Data Analysis","Pandas","TensorFlow","Excel","Communication","Leadership","Figma","Tailwind","Redux"]
_reader = None

def sniff(b):
    if b[:4] == b"%PDF": return "pdf"
    if b[:8] == b"\x89PNG\r\n\x1a\n": return "png"
    if b[:3] == b"\xff\xd8\xff": return "jpg"

def _read(im):
    global _reader
    if _reader is None:
        import easyocr
        _reader = easyocr.Reader(["en"], gpu=False)
    g = ImageOps.autocontrast(ImageOps.grayscale(im)).filter(ImageFilter.MedianFilter(3))
    if g.width < 1200: g = g.resize((g.width * 2, g.height * 2))
    return "\n".join(_reader.readtext(np.array(g), detail=0))

def extract(path, kind):
    if kind == "pdf":
        pages = []
        for p in fitz.open(path):
            t = p.get_text().strip()
            if len(t) < 30:  # scanned page -> OCR
                t = _read(Image.open(io.BytesIO(p.get_pixmap(dpi=200).tobytes("png"))))
            pages.append(t)
        return "\n\n".join(pages)  # one block per page
    return _read(Image.open(path))

def parse(t):
    lines = [l.strip() for l in t.splitlines() if l.strip()]
    em = re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", t)
    ph = re.search(r"\+?\d[\d\s\-()]{8,14}\d", t)
    low = t.lower()
    skills = [v for v in VOCAB if re.search(r"(?<![\w+#])" + re.escape(v.lower()) + r"(?![\w+#])", low)]
    edu = [l for l in lines if re.search(r"b\.?tech|m\.?tech|bachelor|master|b\.?sc|m\.?sc|mba|bca|mca|diploma|university|college", l, re.I)][:3]
    ex = re.search(r"(\d+(?:\.\d+)?)\+?\s*(?:years|yrs)", low)
    return dict(name=lines[0] if lines else None, email=em.group() if em else None,
                phone=ph.group().strip() if ph else None, education="; ".join(edu),
                experience=f"{ex.group(1)} years" if ex else "", skills=skills)
