"""PDF 抽取器与出处核验测试（合成最小 PDF，无任何真实资料）."""

import zlib

import pytest

from conftest import FIXTURES
from study_companion.load import load_all
from study_companion.pdf_text import extract_text, parse_tounicode_cmaps
from study_companion.sourcecheck import verify_sources


def minimal_pdf(bfchar_pairs, cids) -> bytes:
    """手工构造最小可抽取 PDF：ToUnicode bfchar + 内容流 BT..ET 十六进制 Tj."""
    cmap = "/CIDInit /ProcSet findresource begin\n"
    cmap += "1 beginbfchar\n"
    for cid, uni in bfchar_pairs:
        cmap += f"<{cid:04X}> <{uni:04X}>\n"
    cmap += "endbfchar end\n"
    content = "BT\n"
    for cid in cids:
        content += f"<{cid:04X}> Tj\n"
    content += "ET\n"

    def stream(body: str) -> bytes:
        raw = body.encode("latin-1")
        return (f"<< /Length {len(raw)} >>\nstream\n".encode()
                + raw + b"\nendstream")

    pdf = b"%PDF-1.4\n"
    pdf += b"1 0 obj " + stream(cmap) + b" endobj\n"
    pdf += b"2 0 obj " + stream(content) + b" endobj\n"
    pdf += b"trailer\n<< /Root 1 0 R >>\n%%EOF"
    return pdf


def test_extract_text_with_bfchar(tmp_path):
    # 0x0041->中 0x0042->文 0x0043->抽 0x0044->取
    pdf = minimal_pdf([(0x41, 0x4E2D), (0x42, 0x6587),
                       (0x43, 0x62BD), (0x44, 0x53D6)],
                      [0x41, 0x42, 0x43, 0x44])
    path = tmp_path / "mini.pdf"
    path.write_bytes(pdf)
    text = extract_text(path)
    assert "中文抽取" in text


def test_extract_text_flate_compressed(tmp_path):
    body_cmap = "/CIDInit begin\n1 beginbfchar\n<0041> <6D4B>\nendbfchar end\n"
    body_content = "BT\n<0041> Tj\nET\n"
    pdf = b"%PDF-1.4\n"
    for body in (body_cmap, body_content):
        raw = body.encode("latin-1")
        comp = zlib.compress(raw)
        pdf += (f"<< /Length {len(comp)} /Filter /FlateDecode >>\nstream\n".encode()
                + comp + b"\nendstream\n")
    path = tmp_path / "mini_flate.pdf"
    path.write_bytes(pdf)
    assert "测" in extract_text(path)


def test_parse_tounicode_bfrange(tmp_path):
    body = "beginbfrange\n<0001> <0003> <4E00>\nendbfrange"
    path = tmp_path / "range.pdf"
    path.write_bytes(b"%PDF-1.4\nstream\n" + body.encode() + b"\nendstream")
    mapping = parse_tounicode_cmaps(path.read_bytes())
    assert mapping.get(0x0001) == "\u4e00"
    assert mapping.get(0x0003) == "\u4e02"


def test_verify_sources_on_synthetic(tmp_path, dataset):
    """合成数据教材条目=0：核验应通过且各项为空/通过."""
    report = verify_sources(dataset, tmp_path)
    assert report["教材条目章节互证"] == []
    assert report["结论"] in ("通过", "存在未命中项，需人工核对")


def test_verify_sources_chapter_hit_and_miss(tmp_path):
    """命中与未命中路径：条目声称的章名在/不在切片文本中."""
    import shutil
    for name in ["课程要求.csv", "题目与材料.csv", "模拟学生.csv",
                 "测验节点.csv", "字段说明.csv", "作答记录.csv"]:
        shutil.copy(FIXTURES / name, tmp_path / name)
    # 构造带"教材"条目的题库：声称两章，一章在切片文本中、一章不在
    questions = open(FIXTURES / "题目与材料.csv", encoding="utf-8-sig").read().rstrip("\n")
    extra = ("B90,T01,教材,,第三章 代数式；第七章 实验与探究,,,,,,T01I1,"
             "synthetic_slice.pdf")
    open(tmp_path / "题目与材料.csv", "w", encoding="utf-8-sig",
         newline="").write(questions + "\n" + extra + "\n")
    # 切片 PDF 只含"代数式"文本
    pdf = minimal_pdf([(0x41, 0x4EE3), (0x42, 0x6570), (0x43, 0x5F0F)],
                      [0x41, 0x42, 0x43])
    (tmp_path / "synthetic_slice.pdf").write_bytes(pdf)

    ds = load_all(tmp_path)
    report = verify_sources(ds, tmp_path)
    entry = report["教材条目章节互证"][0]
    assert entry["材料编号"] == "B90"
    hit = [c for c in entry["声称章节"] if "代数式" in c]
    miss = [c for c in entry["声称章节"] if "实验" in c]
    assert hit and miss
    assert miss[0] in entry["未命中章节"]
    assert hit[0] not in entry["未命中章节"]
    assert report["结论"] != "通过"
