from __future__ import annotations

import csv
import io

from openpyxl import load_workbook

HEADER_ALIASES = {
    "nickname": "nickname", "ник": "nickname", "nick": "nickname", "name": "nickname", "имя": "nickname",
    "telegram_id": "telegram_id", "tg_id": "telegram_id", "id": "telegram_id",
    "place": "place", "место": "place",
    "points": "points", "очки": "points", "баллы": "points",
    "bounty": "bounty", "баунти": "bounty", "бонус": "bounty",
}

REQUIRED = {"place"}


class ParseError(Exception):
    pass


def _normalize_header(cell: object) -> str | None:
    if cell is None:
        return None
    key = str(cell).strip().lower()
    return HEADER_ALIASES.get(key)


def _decode_csv_bytes(data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp1251"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _rows_from_csv(data: bytes) -> list[list[object]]:
    text = _decode_csv_bytes(data)
    sniffed_delim = ";" if text.split("\n", 1)[0].count(";") >= text.split("\n", 1)[0].count(",") else ","
    reader = csv.reader(io.StringIO(text), delimiter=sniffed_delim)
    return [row for row in reader if any(str(c).strip() for c in row)]


def _rows_from_xlsx(data: bytes) -> list[list[object]]:
    wb = load_workbook(io.BytesIO(data), data_only=True)
    ws = wb.active
    rows = []
    for row in ws.iter_rows(values_only=True):
        if any(c is not None and str(c).strip() for c in row):
            rows.append(list(row))
    return rows


def parse_results_table(data: bytes, filename: str) -> list[dict]:
    """Returns a list of {nickname?, telegram_id?, place, points, bounty}.
    Raises ParseError with a human-readable message on malformed input."""
    lower = filename.lower()
    if lower.endswith(".xlsx") or lower.endswith(".xlsm"):
        rows = _rows_from_xlsx(data)
    elif lower.endswith(".csv"):
        rows = _rows_from_csv(data)
    else:
        raise ParseError("Поддерживаются только .csv и .xlsx файлы.")

    if len(rows) < 2:
        raise ParseError("В файле должна быть строка заголовков и хотя бы одна строка данных.")

    header = [_normalize_header(c) for c in rows[0]]
    if "nickname" not in header and "telegram_id" not in header:
        raise ParseError("Нужна колонка nickname (ник) или telegram_id.")
    missing = REQUIRED - set(c for c in header if c)
    if missing:
        raise ParseError(f"Не хватает колонок: {', '.join(missing)}.")

    results = []
    for line_no, row in enumerate(rows[1:], start=2):
        entry: dict = {"nickname": None, "telegram_id": None, "points": 0, "bounty": 0}
        for col_idx, col_name in enumerate(header):
            if not col_name or col_idx >= len(row):
                continue
            value = row[col_idx]
            if value is None or str(value).strip() == "":
                continue
            if col_name == "nickname":
                entry["nickname"] = str(value).strip()
            elif col_name == "telegram_id":
                entry["telegram_id"] = int(float(value))
            elif col_name == "place":
                entry["place"] = int(float(value))
            elif col_name in ("points", "bounty"):
                entry[col_name] = int(float(value))
        if "place" not in entry:
            raise ParseError(f"Строка {line_no}: не указано место.")
        if not entry["nickname"] and not entry["telegram_id"]:
            raise ParseError(f"Строка {line_no}: не указан ни ник, ни telegram_id.")
        results.append(entry)
    return results
