#!/usr/bin/env python3
"""纯标准库 PDF 中文文本抽取（最小可用版，出处核验用）.

原理：扫描全部流（原始+Flate 解压），解析 ToUnicode CMap 的
bfchar/bfrange 得到 CID->Unicode 映射；再解码内容流中 TJ/Tj 的
十六进制 CID 串。多个子集字体的映射合并为一张表（对"关键词存在性"
验证足够；不做坐标级排版还原）。

仅用于出处核验（competition 工具），不追求通用 PDF 解析正确性。
"""

import re
import zlib
from pathlib import Path


def _iter_streams(data: bytes):
    for m in re.finditer(rb"stream\r?\n", data):
        start = m.end()
        end = data.find(b"endstream", start)
        if end < 0:
            continue
        raw = data[start:end]
        yield raw
        try:
            yield zlib.decompress(raw)
        except Exception:
            pass


def parse_tounicode_cmaps(data: bytes) -> dict:
    """合并文档内全部 ToUnicode CMap 为 {cid:int -> str}。"""
    mapping = {}
    for blob in _iter_streams(data):
        if b"beginbfchar" not in blob and b"beginbfrange" not in blob:
            continue
        text = blob.decode("latin-1", errors="ignore")
        for block in re.findall(r"beginbfchar(.*?)endbfchar", text, re.S):
            for src, dst in re.findall(
                    r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
                cid = int(src, 16)
                try:
                    mapping[cid] = bytes.fromhex(dst).decode(
                        "utf-16-be", errors="ignore")
                except ValueError:
                    pass
        for block in re.findall(r"beginbfrange(.*?)endbfrange", text, re.S):
            for lo, hi, dst in re.findall(
                    r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>",
                    block):
                lo_i, hi_i = int(lo, 16), int(hi, 16)
                try:
                    base = int(dst, 16)
                except ValueError:
                    continue
                for cid in range(lo_i, hi_i + 1):
                    mapping[cid] = chr(base + (cid - lo_i))
    return mapping


def extract_text(path) -> str:
    data = Path(path).read_bytes()
    mapping = parse_tounicode_cmaps(data)
    chunks = []
    for blob in _iter_streams(data):
        if b"BT" not in blob or (b"TJ" not in blob and b"Tj" not in blob):
            continue
        # 线性扫描：BT..ET 文本块内按出现顺序解码全部十六进制串
        # （关键词存在性验证不需要操作符级分组，避免嵌套正则回溯）
        pos = 0
        while True:
            start = blob.find(b"BT", pos)
            if start < 0:
                break
            end = blob.find(b"ET", start)
            if end < 0:
                end = len(blob)
            block = blob[start:end]
            for m in re.finditer(rb"<([0-9A-Fa-f]{4,})>", block):
                s = m.group(1).decode()
                out = []
                for i in range(0, len(s) - 3, 4):
                    out.append(mapping.get(int(s[i:i + 4], 16), ""))
                chunks.append("".join(out))
            pos = end + 2
    return "".join(chunks)


if __name__ == "__main__":
    import sys
    text = extract_text(sys.argv[1])
    print(f"抽取 {len(text)} 字符，样本:")
    print(text[:400])
