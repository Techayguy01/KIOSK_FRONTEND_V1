"""
core/ocr_service.py

Phase 1 OCR helper:
- decode base64 image payloads
- isolate the document region before OCR
- apply lightweight perspective normalization
- run OCR lazily (EasyOCR on CPU preferred, Tesseract fallback)
- parse deterministic identity fields for check-in lookup
"""

from __future__ import annotations

import base64
import os
import re
import subprocess
import threading
from dataclasses import dataclass
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Optional

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:
    # OCR can still run with process-level env vars even if dotenv import is unavailable.
    pass

# EasyOCR + OpenCV + Torch on Windows/Conda can load duplicate OpenMP runtimes.
# This keeps the OCR worker from aborting during module import on kiosk builds.
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")


class OcrError(Exception):
    """Base OCR error for deterministic API-level error mapping."""


class OcrEngineUnavailableError(OcrError):
    """Raised when OCR runtime dependencies or binary are unavailable."""


class OcrBadImageError(OcrError):
    """Raised for invalid or unreadable image payloads."""


class OcrProcessingError(OcrError):
    """Raised for OCR runtime processing failures."""


_EASYOCR_READER = None
_EASYOCR_READER_LOCK = threading.Lock()
_EASYOCR_MODEL_DIR = Path(__file__).resolve().parent.parent / ".easyocr"


@dataclass(frozen=True)
class NormalizedCropBox:
    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True)
class _DocumentDetection:
    bbox: tuple[int, int, int, int]
    corners: Optional[tuple[tuple[float, float], tuple[float, float], tuple[float, float], tuple[float, float]]]


def decode_image_data_url(image_data_url: str) -> bytes:
    if not image_data_url:
        raise OcrBadImageError("imageDataUrl is required.")

    payload = image_data_url.strip()
    if payload.startswith("data:"):
        if "," not in payload:
            raise OcrBadImageError("Invalid data URL format for imageDataUrl.")
        payload = payload.split(",", 1)[1]

    payload = payload.strip().replace("\n", "").replace("\r", "")
    try:
        return base64.b64decode(payload, validate=False)
    except Exception as exc:
        raise OcrBadImageError(f"Invalid base64 image payload: {exc}") from exc


def _resolve_tesseract_cmd() -> str:
    configured_cmd = os.getenv("TESSERACT_CMD", "").strip()
    if configured_cmd:
        return configured_cmd

    local_appdata = os.getenv("LOCALAPPDATA", "").strip()
    fallback_candidates = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ]
    if local_appdata:
        fallback_candidates.insert(0, str(Path(local_appdata) / "Programs" / "Tesseract-OCR" / "tesseract.exe"))

    for candidate in fallback_candidates:
        if Path(candidate).exists():
            return candidate

    return ""


def _get_easyocr_reader(language: str = "en"):
    global _EASYOCR_READER

    try:
        import easyocr  # type: ignore
    except Exception as exc:
        raise OcrEngineUnavailableError("Python dependency missing: install easyocr.") from exc

    with _EASYOCR_READER_LOCK:
        if _EASYOCR_READER is None:
            _EASYOCR_MODEL_DIR.mkdir(parents=True, exist_ok=True)
            try:
                _EASYOCR_READER = easyocr.Reader(
                    [language or "en"],
                    gpu=False,
                    verbose=False,
                    model_storage_directory=str(_EASYOCR_MODEL_DIR),
                    user_network_directory=str(_EASYOCR_MODEL_DIR),
                )
            except Exception as exc:
                raise OcrEngineUnavailableError(
                    "EasyOCR model files are not ready. Install EasyOCR and download its CPU model files."
                ) from exc
    return _EASYOCR_READER


def _get_tesseract_status() -> dict:
    try:
        import pytesseract  # type: ignore
    except Exception:
        return {
            "available": False,
            "engine": "pytesseract",
            "message": "Python dependency missing: install pytesseract.",
            "tesseract_cmd": "",
        }

    resolved_cmd = _resolve_tesseract_cmd()
    if resolved_cmd:
        pytesseract.pytesseract.tesseract_cmd = resolved_cmd

    probe_cmd = resolved_cmd or "tesseract"
    try:
        subprocess.run(
            [probe_cmd, "--version"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
            timeout=5,
        )
    except Exception:
        return {
            "available": False,
            "engine": "pytesseract",
            "message": (
                "Tesseract OCR binary not found. "
                "Install Tesseract and set TESSERACT_CMD to tesseract.exe."
            ),
            "tesseract_cmd": probe_cmd,
        }

    return {
        "available": True,
        "engine": "pytesseract",
        "message": "OCR engine available.",
        "tesseract_cmd": probe_cmd,
    }


def get_ocr_engine_status() -> dict:
    try:
        from PIL import Image  # type: ignore  # noqa: F401
    except Exception:
        return {
            "available": False,
            "engine": "none",
            "message": "Python dependency missing: install Pillow.",
            "tesseract_cmd": "",
        }

    try:
        import easyocr  # type: ignore  # noqa: F401
        import torch  # type: ignore  # noqa: F401
        return {
            "available": True,
            "engine": "easyocr",
            "message": "EasyOCR engine available (CPU mode).",
            "tesseract_cmd": "",
        }
    except Exception:
        return _get_tesseract_status()


def _clamp_fraction(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _pil_resample(name: str):
    from PIL import Image  # type: ignore

    resampling = getattr(Image, "Resampling", Image)
    return getattr(resampling, name, getattr(Image, name))


def _pil_transform_quad():
    from PIL import Image  # type: ignore

    transform = getattr(Image, "Transform", Image)
    return getattr(transform, "QUAD", getattr(Image, "QUAD"))


def _crop_to_frame(image, crop_box: Optional[NormalizedCropBox]):
    if not crop_box:
        return image

    width, height = image.size
    left = int(round(width * _clamp_fraction(crop_box.x)))
    top = int(round(height * _clamp_fraction(crop_box.y)))
    right = int(round(width * _clamp_fraction(crop_box.x + crop_box.width)))
    bottom = int(round(height * _clamp_fraction(crop_box.y + crop_box.height)))

    if right - left < max(80, width // 6) or bottom - top < max(60, height // 6):
        return image

    return image.crop((left, top, right, bottom))


def _fit_y_from_x(points: list[tuple[float, float]]) -> Optional[tuple[float, float]]:
    if len(points) < 8:
        return None
    sum_x = sum(point[0] for point in points)
    sum_y = sum(point[1] for point in points)
    sum_xx = sum(point[0] * point[0] for point in points)
    sum_xy = sum(point[0] * point[1] for point in points)
    count = float(len(points))
    denominator = (count * sum_xx) - (sum_x * sum_x)
    if abs(denominator) < 1e-6:
        return None
    slope = ((count * sum_xy) - (sum_x * sum_y)) / denominator
    intercept = (sum_y - (slope * sum_x)) / count
    return slope, intercept


def _fit_x_from_y(points: list[tuple[float, float]]) -> Optional[tuple[float, float]]:
    if len(points) < 8:
        return None
    sum_y = sum(point[1] for point in points)
    sum_x = sum(point[0] for point in points)
    sum_yy = sum(point[1] * point[1] for point in points)
    sum_xy = sum(point[0] * point[1] for point in points)
    count = float(len(points))
    denominator = (count * sum_yy) - (sum_y * sum_y)
    if abs(denominator) < 1e-6:
        return None
    slope = ((count * sum_xy) - (sum_y * sum_x)) / denominator
    intercept = (sum_x - (slope * sum_y)) / count
    return slope, intercept


def _intersection(
    horizontal: tuple[float, float],
    vertical: tuple[float, float],
) -> Optional[tuple[float, float]]:
    h_slope, h_intercept = horizontal
    v_slope, v_intercept = vertical
    denominator = 1.0 - (v_slope * h_slope)
    if abs(denominator) < 1e-6:
        return None
    x = ((v_slope * h_intercept) + v_intercept) / denominator
    y = (h_slope * x) + h_intercept
    return x, y


def _expand_bbox(
    bbox: tuple[int, int, int, int],
    image_size: tuple[int, int],
    pad_ratio: float = 0.03,
) -> tuple[int, int, int, int]:
    left, top, right, bottom = bbox
    width, height = image_size
    pad_x = max(4, int((right - left) * pad_ratio))
    pad_y = max(4, int((bottom - top) * pad_ratio))
    return (
        max(0, left - pad_x),
        max(0, top - pad_y),
        min(width, right + pad_x),
        min(height, bottom + pad_y),
    )


def _collect_top_points(mask, bbox: tuple[int, int, int, int]) -> list[tuple[float, float]]:
    pixels = mask.load()
    left, top, right, bottom = bbox
    search_depth = max(12, int((bottom - top) * 0.28))
    step = max(1, (right - left) // 80)
    points: list[tuple[float, float]] = []
    for x in range(left, right, step):
        for y in range(top, min(bottom, top + search_depth)):
            if pixels[x, y] > 0:
                points.append((float(x), float(y)))
                break
    return points


def _collect_bottom_points(mask, bbox: tuple[int, int, int, int]) -> list[tuple[float, float]]:
    pixels = mask.load()
    left, top, right, bottom = bbox
    search_depth = max(12, int((bottom - top) * 0.28))
    step = max(1, (right - left) // 80)
    points: list[tuple[float, float]] = []
    for x in range(left, right, step):
        for y in range(bottom - 1, max(top - 1, bottom - search_depth), -1):
            if pixels[x, y] > 0:
                points.append((float(x), float(y)))
                break
    return points


def _collect_left_points(mask, bbox: tuple[int, int, int, int]) -> list[tuple[float, float]]:
    pixels = mask.load()
    left, top, right, bottom = bbox
    search_width = max(12, int((right - left) * 0.28))
    step = max(1, (bottom - top) // 80)
    points: list[tuple[float, float]] = []
    for y in range(top, bottom, step):
        for x in range(left, min(right, left + search_width)):
            if pixels[x, y] > 0:
                points.append((float(x), float(y)))
                break
    return points


def _collect_right_points(mask, bbox: tuple[int, int, int, int]) -> list[tuple[float, float]]:
    pixels = mask.load()
    left, top, right, bottom = bbox
    search_width = max(12, int((right - left) * 0.28))
    step = max(1, (bottom - top) // 80)
    points: list[tuple[float, float]] = []
    for y in range(top, bottom, step):
        for x in range(right - 1, max(left - 1, right - search_width), -1):
            if pixels[x, y] > 0:
                points.append((float(x), float(y)))
                break
    return points


def _detect_document_region(image) -> Optional[_DocumentDetection]:
    from PIL import ImageFilter, ImageOps  # type: ignore

    width, height = image.size
    if width < 80 or height < 60:
        return None

    detect_scale = 1.0
    working = image
    if width > 900:
        detect_scale = 900.0 / float(width)
        working = image.resize(
            (int(width * detect_scale), int(height * detect_scale)),
            resample=_pil_resample("BILINEAR"),
        )

    grayscale = ImageOps.grayscale(working)
    grayscale = ImageOps.autocontrast(grayscale)
    grayscale = grayscale.filter(ImageFilter.GaussianBlur(radius=1.2))
    edges = grayscale.filter(ImageFilter.FIND_EDGES)
    mask = edges.point(lambda px: 255 if px > 32 else 0, mode="L")
    mask = mask.filter(ImageFilter.MaxFilter(size=5))
    mask = mask.filter(ImageFilter.MedianFilter(size=3))

    bbox = mask.getbbox()
    if not bbox:
        return None

    bbox_width = bbox[2] - bbox[0]
    bbox_height = bbox[3] - bbox[1]
    image_area = float(mask.size[0] * mask.size[1])
    bbox_area = float(bbox_width * bbox_height)
    if bbox_width < mask.size[0] * 0.45 or bbox_height < mask.size[1] * 0.35:
        return None
    if bbox_area / image_area < 0.28:
        return None

    top_points = _collect_top_points(mask, bbox)
    bottom_points = _collect_bottom_points(mask, bbox)
    left_points = _collect_left_points(mask, bbox)
    right_points = _collect_right_points(mask, bbox)

    top_line = _fit_y_from_x(top_points)
    bottom_line = _fit_y_from_x(bottom_points)
    left_line = _fit_x_from_y(left_points)
    right_line = _fit_x_from_y(right_points)

    corners = None
    if top_line and bottom_line and left_line and right_line:
        tl = _intersection(top_line, left_line)
        tr = _intersection(top_line, right_line)
        br = _intersection(bottom_line, right_line)
        bl = _intersection(bottom_line, left_line)
        candidate_corners = (tl, tr, br, bl)
        if all(point is not None for point in candidate_corners):
            points = candidate_corners  # type: ignore[assignment]
            if all(
                -mask.size[0] * 0.1 <= point[0] <= mask.size[0] * 1.1
                and -mask.size[1] * 0.1 <= point[1] <= mask.size[1] * 1.1
                for point in points
            ):
                corners = tuple(
                    (
                        point[0] / detect_scale,
                        point[1] / detect_scale,
                    )
                    for point in points
                )

    scaled_bbox = (
        int(round(bbox[0] / detect_scale)),
        int(round(bbox[1] / detect_scale)),
        int(round(bbox[2] / detect_scale)),
        int(round(bbox[3] / detect_scale)),
    )
    return _DocumentDetection(
        bbox=_expand_bbox(scaled_bbox, image.size),
        corners=corners,
    )


def _distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5


def _normalize_document_image(image):
    from PIL import Image  # type: ignore

    detection = _detect_document_region(image)
    if not detection:
        return image

    working = image.crop(detection.bbox)
    if not detection.corners:
        return working

    left, top, _, _ = detection.bbox
    local_tl = (detection.corners[0][0] - left, detection.corners[0][1] - top)
    local_tr = (detection.corners[1][0] - left, detection.corners[1][1] - top)
    local_br = (detection.corners[2][0] - left, detection.corners[2][1] - top)
    local_bl = (detection.corners[3][0] - left, detection.corners[3][1] - top)

    target_width = int(round(max(_distance(local_tl, local_tr), _distance(local_bl, local_br))))
    target_height = int(round(max(_distance(local_tl, local_bl), _distance(local_tr, local_br))))

    if target_width < 160 or target_height < 100:
        return working

    return working.transform(
        (target_width, target_height),
        _pil_transform_quad(),
        data=[
            local_tl[0],
            local_tl[1],
            local_bl[0],
            local_bl[1],
            local_br[0],
            local_br[1],
            local_tr[0],
            local_tr[1],
        ],
        resample=_pil_resample("BICUBIC"),
    )


def _prepare_ocr_images(image):
    from PIL import ImageEnhance, ImageFilter, ImageOps  # type: ignore

    grayscale = ImageOps.grayscale(image)
    contrast = ImageEnhance.Contrast(grayscale).enhance(1.5)
    contrast = ImageOps.autocontrast(contrast, cutoff=1)
    width, height = contrast.size
    if width < 1600:
        scale = min(2.4, 1600.0 / float(max(width, 1)))
        contrast = contrast.resize(
            (max(1, int(width * scale)), max(1, int(height * scale))),
            resample=_pil_resample("LANCZOS"),
        )
    denoised = contrast.filter(ImageFilter.MedianFilter(size=3))
    sharpened = denoised.filter(ImageFilter.SHARPEN)
    adaptive_threshold = sharpened.point(lambda px: 255 if px > 158 else 0, mode="1")
    soft_threshold = sharpened.point(lambda px: 255 if px > 138 else 0, mode="1")
    return [
        ("sharpened", sharpened),
        ("adaptive_threshold", adaptive_threshold),
        ("soft_threshold", soft_threshold),
    ]


def _group_easyocr_lines(results) -> str:
    positioned_tokens: list[dict] = []
    for item in results:
        if len(item) < 3:
            continue
        bbox, text, _ = item
        token = str(text or "").strip()
        if not token:
            continue
        try:
            xs = [float(point[0]) for point in bbox]
            ys = [float(point[1]) for point in bbox]
        except Exception:
            continue
        min_x = min(xs)
        min_y = min(ys)
        max_y = max(ys)
        positioned_tokens.append(
            {
                "text": token,
                "x": min_x,
                "center_y": (min_y + max_y) / 2.0,
                "height": max(1.0, max_y - min_y),
            }
        )

    if not positioned_tokens:
        return ""

    positioned_tokens.sort(key=lambda item: (item["center_y"], item["x"]))
    lines: list[dict] = []
    for token in positioned_tokens:
        if not lines:
            lines.append(
                {
                    "center_y": token["center_y"],
                    "height": token["height"],
                    "tokens": [token],
                }
            )
            continue

        current_line = lines[-1]
        max_delta = max(current_line["height"], token["height"]) * 0.7
        if abs(token["center_y"] - current_line["center_y"]) <= max_delta:
            current_line["tokens"].append(token)
            current_line["center_y"] = (
                current_line["center_y"] * (len(current_line["tokens"]) - 1) + token["center_y"]
            ) / len(current_line["tokens"])
            current_line["height"] = max(current_line["height"], token["height"])
        else:
            lines.append(
                {
                    "center_y": token["center_y"],
                    "height": token["height"],
                    "tokens": [token],
                }
            )

    output_lines: list[str] = []
    for line in lines:
        sorted_tokens = sorted(line["tokens"], key=lambda item: item["x"])
        line_text = _normalize_whitespace(" ".join(str(item["text"]) for item in sorted_tokens))
        if line_text:
            output_lines.append(line_text)
    return "\n".join(output_lines)


def _run_easyocr(candidates, language: str = "en") -> tuple[str, float]:
    import numpy as np  # type: ignore

    reader = _get_easyocr_reader(language=language or "en")

    best_text = ""
    best_confidence = 0.0

    for _, candidate_image in candidates:
        rgb_image = candidate_image.convert("RGB")
        image_array = np.array(rgb_image)
        try:
            results = reader.readtext(
                image_array,
                detail=1,
                paragraph=False,
                batch_size=1,
            )
        except Exception as exc:
            raise OcrProcessingError("EasyOCR processing failed for this image.") from exc

        confidences = []
        for item in results:
            if len(item) < 3:
                continue
            _, _, confidence = item
            try:
                confidences.append(float(confidence))
            except Exception:
                continue

        candidate_text = _group_easyocr_lines(results)
        candidate_confidence = 0.0
        if confidences:
            candidate_confidence = max(0.0, min(1.0, round(sum(confidences) / len(confidences), 3)))

        score = (candidate_confidence * 1.25) + min(len(candidate_text), 220) / 500.0
        best_score = (best_confidence * 1.25) + min(len(best_text), 220) / 500.0
        if score >= best_score:
            best_text = candidate_text
            best_confidence = candidate_confidence

    return best_text, best_confidence


def _run_tesseract(candidates, language: str = "eng") -> tuple[str, float]:
    import pytesseract  # type: ignore

    ocr_config = "--oem 3 --psm 6"

    def _extract_from_data(img) -> tuple[str, float]:
        data = pytesseract.image_to_data(
            img,
            lang=(language or "eng"),
            output_type=pytesseract.Output.DICT,
            config=ocr_config,
        )
        text_tokens = [str(token).strip() for token in data.get("text", []) if str(token).strip()]
        token_text = " ".join(text_tokens).strip()

        raw_conf_values = data.get("conf", []) or []
        valid_conf = []
        for raw_conf in raw_conf_values:
            try:
                value = float(raw_conf)
            except Exception:
                continue
            if value >= 0:
                valid_conf.append(value)

        confidence = 0.0
        if valid_conf:
            confidence = max(0.0, min(1.0, round((sum(valid_conf) / len(valid_conf)) / 100.0, 3)))
        return token_text, confidence

    best_text = ""
    best_confidence = 0.0
    best_image = candidates[0][1]

    try:
        for _, candidate_image in candidates:
            candidate_text, candidate_confidence = _extract_from_data(candidate_image)
            score = (candidate_confidence * 1.25) + min(len(candidate_text), 220) / 500.0
            best_score = (best_confidence * 1.25) + min(len(best_text), 220) / 500.0
            if score >= best_score:
                best_text = candidate_text
                best_confidence = candidate_confidence
                best_image = candidate_image
    except Exception as exc:
        active_cmd = getattr(pytesseract.pytesseract, "tesseract_cmd", "") or "tesseract"
        raise OcrProcessingError(
            "OCR processing failed for this image. "
            f"Resolved command: '{active_cmd}'."
        ) from exc

    text = str(
        pytesseract.image_to_string(
            best_image,
            lang=(language or "eng"),
            config=ocr_config,
        )
    ).strip()
    if not text:
        text = best_text

    return text, best_confidence


def run_ocr(
    image_bytes: bytes,
    language: str = "eng",
    crop_box: Optional[NormalizedCropBox] = None,
) -> tuple[str, float]:
    if not image_bytes:
        raise OcrBadImageError("Empty image payload.")

    engine_status = get_ocr_engine_status()
    if not engine_status.get("available"):
        raise OcrEngineUnavailableError(
            f"{engine_status.get('message')} Resolved command: '{engine_status.get('tesseract_cmd') or 'unset'}'."
        )

    from PIL import Image, ImageOps  # type: ignore

    try:
        image = Image.open(BytesIO(image_bytes)).convert("RGB")
        image = ImageOps.exif_transpose(image)
    except Exception as exc:
        raise OcrBadImageError("Unreadable image content. Please retry with a clearer scan.") from exc

    image = _crop_to_frame(image, crop_box)
    image = _normalize_document_image(image)
    candidates = _prepare_ocr_images(image)
    if engine_status.get("engine") == "easyocr":
        engine_language = "en" if (language or "eng").lower().startswith("en") else "en"
        return _run_easyocr(candidates, language=engine_language)

    return _run_tesseract(candidates, language=language or "eng")


def _normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()


def _normalize_date(raw_date: str) -> Optional[str]:
    value = (raw_date or "").strip()
    if not value:
        return None

    value = re.sub(r"(?i)(\d)(st|nd|rd|th)\b", r"\1", value)
    value = re.sub(r"\s+", " ", value).strip()

    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y-%m-%d", "%d/%m/%y", "%d-%m-%y", "%d %m %Y", "%d %m %y"):
        try:
            parsed = datetime.strptime(value, fmt).date()
            if parsed.year < 1930 or parsed.year > datetime.utcnow().year:
                continue
            return parsed.isoformat()
        except Exception:
            continue

    month_variants = ("%d %b %Y", "%d %B %Y", "%b %d %Y", "%B %d %Y", "%d-%b-%Y", "%d-%B-%Y", "%b-%d-%Y", "%B-%d-%Y")
    normalized_month_value = re.sub(r"[,\./]", " ", value)
    normalized_month_value = re.sub(r"\s+", " ", normalized_month_value).strip()
    for fmt in month_variants:
        try:
            parsed = datetime.strptime(normalized_month_value, fmt).date()
            if parsed.year < 1930 or parsed.year > datetime.utcnow().year:
                continue
            return parsed.isoformat()
        except Exception:
            continue

    return None


def _normalize_ocr_digits(value: str) -> str:
    translation = str.maketrans(
        {
            "O": "0",
            "Q": "0",
            "D": "0",
            "I": "1",
            "L": "1",
            "Z": "2",
            "S": "5",
            "B": "8",
            "G": "6",
        }
    )
    return value.upper().translate(translation)


def _extract_aadhaar_number(text: str) -> Optional[str]:
    patterns = [
        r"(?<!\d)([2-9][0-9OQDILZSBG]{3}[\s-]+[0-9OQDILZSBG]{4}[\s-]+[0-9OQDILZSBG]{4})(?!\d)",
        r"(?<!\d)([2-9][0-9OQDILZSBG]{11})(?!\d)",
    ]
    for pattern in patterns:
        for candidate in re.findall(pattern, text, re.IGNORECASE):
            digits = re.sub(r"\D", "", _normalize_ocr_digits(candidate))
            if len(digits) == 12 and digits[0] in "23456789":
                return digits

    fallback_candidates = re.findall(r"([0-9OQDILZSBG\s-]{12,20})", text, re.IGNORECASE)
    for candidate in fallback_candidates:
        digits = re.sub(r"\D", "", _normalize_ocr_digits(candidate))
        if len(digits) == 12 and digits[0] in "23456789":
            return digits
    return None


def _looks_like_aadhaar_text(text: str) -> bool:
    normalized = _normalize_whitespace(text).lower()
    has_grouped_number = bool(
        re.search(r"\b[2-9][0-9oildqzsbg]{3}[\s-]+[0-9oildqzsbg]{4}[\s-]+[0-9oildqzsbg]{4}\b", normalized)
    )
    has_birth_anchor = bool(re.search(r"\b(dob|yob|year of birth)\b", normalized))
    has_gender_anchor = bool(re.search(r"\b(male|female|gender)\b", normalized))
    has_uid_keyword = any(token in normalized for token in ("aadhaar", "uidai", "uid", "enrolment"))
    has_government_hint = (
        ("gov" in normalized or "government" in normalized or "gove" in normalized)
        and ("ind" in normalized or "india" in normalized)
    )

    if has_uid_keyword:
        return True
    if has_grouped_number and has_birth_anchor:
        return True
    if has_grouped_number and has_gender_anchor:
        return True
    if has_grouped_number and has_government_hint:
        return True
    if has_birth_anchor and has_gender_anchor and has_government_hint:
        return True
    return False


def _extract_document_number(text: str, document_type_hint: Optional[str] = None) -> Optional[str]:
    compact_text = _normalize_whitespace(text)
    normalized_hint = (document_type_hint or "").upper()
    aadhaar_number = _extract_aadhaar_number(compact_text)

    if normalized_hint == "AADHAAR" or _looks_like_aadhaar_text(compact_text):
        if aadhaar_number:
            return aadhaar_number

    passport_match = re.search(r"\b([A-PR-WY][0-9]{7})\b", compact_text, re.IGNORECASE)
    if passport_match:
        return passport_match.group(1).upper()

    dl_match = re.search(
        r"\b([A-Z]{2}[\s-]?\d{2}[\s-]?\d{4}[\s-]?\d{7})\b",
        compact_text,
        re.IGNORECASE,
    )
    if dl_match:
        return re.sub(r"[\s-]+", "", dl_match.group(1).upper())

    labeled_match = re.search(
        r"(?:document\s*no|id\s*no|passport\s*no|dl\s*no|licen[cs]e\s*no)\s*[:\-]?\s*([A-Z0-9\-]{6,20})",
        compact_text,
        re.IGNORECASE,
    )
    if labeled_match:
        return labeled_match.group(1).replace("-", "").upper()

    return None


def _infer_document_type(text: str, document_number: Optional[str]) -> str:
    normalized = (text or "").lower()
    compact_number = (document_number or "").strip()
    aadhaar_number_detected = bool(re.fullmatch(r"[2-9]\d{11}", compact_number))

    if (
        _looks_like_aadhaar_text(normalized)
        or aadhaar_number_detected
    ):
        return "AADHAAR"
    if (
        "passport" in normalized
        or "republic of india" in normalized
        or bool(re.fullmatch(r"[A-Z][0-9]{7}", compact_number))
    ):
        return "PASSPORT"
    if "driving licence" in normalized or "driving license" in normalized or "dl no" in normalized:
        return "DRIVER_LICENSE"
    if bool(re.fullmatch(r"[A-Z]{2}\d{13}", compact_number)):
        return "DRIVER_LICENSE"

    return "UNKNOWN"


def _extract_year_of_birth(text: str) -> Optional[str]:
    normalized_text = _normalize_whitespace(text)
    match = re.search(
        r"(?:yob|year of birth)\s*[:\-]?\s*(\d{4})\b",
        normalized_text,
        re.IGNORECASE,
    )
    if match:
        year = match.group(1)
        current_year = datetime.utcnow().year
        if 1930 <= int(year) <= current_year:
            return year
    return None


def _extract_date_of_birth(text: str) -> Optional[str]:
    normalized_text = _normalize_whitespace(text)
    labeled_match = re.search(
        r"(?:dob|date of birth|birth)\s*[:\-]?\s*([A-Za-z0-9,\-/\. ]{6,30})",
        normalized_text,
        re.IGNORECASE,
    )
    if labeled_match:
        normalized = _normalize_date(labeled_match.group(1))
        if normalized:
            return normalized

    generic_matches = re.findall(r"\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\b", normalized_text)
    for candidate in generic_matches:
        normalized = _normalize_date(candidate)
        if normalized:
            return normalized

    month_word_matches = re.findall(
        r"\b(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2}\s+\d{2,4})\b",
        normalized_text,
    )
    for candidate in month_word_matches:
        normalized = _normalize_date(candidate)
        if normalized:
            return normalized

    return None


def _clean_name_line(line: str) -> str:
    cleaned = re.sub(r"[^A-Za-z\s:/-]", " ", line or "")
    cleaned = re.sub(r"\b(?:mr|mrs|ms|dr)\b\.?", " ", cleaned, flags=re.IGNORECASE)
    return _normalize_whitespace(cleaned.replace("/", " "))


def _score_name_candidate(candidate: str) -> int:
    normalized = _normalize_whitespace(candidate)
    if not normalized or not re.fullmatch(r"[A-Za-z ]{4,60}", normalized):
        return -999

    tokens = [token for token in normalized.split(" ") if token]
    if len(tokens) < 2 or len(tokens) > 4:
        return -999
    if any(len(token) < 2 for token in tokens):
        return -999
    if max(len(token) for token in tokens) < 4:
        return -999

    blocked_tokens = {
        "government",
        "india",
        "passport",
        "address",
        "female",
        "male",
        "sex",
        "dob",
        "birth",
        "aadhaar",
        "driving",
        "licence",
        "license",
        "year",
        "signature",
        "authority",
        "card",
        "unique",
        "identification",
        "issued",
        "downloaded",
        "verified",
        "father",
        "mother",
        "husband",
        "wife",
        "care",
    }
    if any(token.lower() in blocked_tokens for token in tokens):
        return -999

    vowel_counts = [sum(1 for ch in token.lower() if ch in "aeiou") for token in tokens]
    if sum(1 for count in vowel_counts if count == 0) > 0:
        return -999

    short_tokens = sum(1 for token in tokens if len(token) <= 2)
    if short_tokens > 0:
        return -999

    score = 0
    if len(tokens) == 2:
        score += 8
    elif len(tokens) == 3:
        score += 3
    else:
        score -= 2
    score += int(round(sum(len(token) for token in tokens) / len(tokens))) * 2
    score += min(12, len(normalized) // 2)
    if 10 <= len(normalized) <= 26:
        score += 4
    if all(token[0].isalpha() for token in tokens):
        score += 2
    return score


def _extract_best_name_from_line(line: str) -> Optional[str]:
    cleaned = _clean_name_line(line)
    if not cleaned:
        return None

    anchor_present = False
    anchor_match = re.search(r"\b(dob|yob|year of birth|male|female|gender)\b", cleaned, re.IGNORECASE)
    if anchor_match:
        anchor_present = True
        cleaned = cleaned[:anchor_match.start()].strip()

    tokens = re.findall(r"[A-Za-z]+", cleaned)
    if len(tokens) < 2:
        return None

    best_candidate: Optional[str] = None
    best_score = -999
    max_window = min(4, len(tokens))
    for window_size in range(2, max_window + 1):
        for start in range(0, len(tokens) - window_size + 1):
            candidate = " ".join(tokens[start : start + window_size])
            score = _score_name_candidate(candidate)
            if anchor_present:
                distance_from_end = len(tokens) - (start + window_size)
                if distance_from_end > 2:
                    score -= distance_from_end * 3
                else:
                    score += 4 - distance_from_end
            if score > best_score:
                best_score = score
                best_candidate = candidate.title()

    if best_candidate and best_score >= 12:
        return best_candidate
    return None


def _is_plausible_name(candidate: str, *, allow_single_token: bool = False) -> bool:
    candidate = _normalize_whitespace(candidate)
    if not candidate or not re.fullmatch(r"[A-Za-z ]{4,60}", candidate):
        return False
    tokens = [token for token in candidate.split(" ") if token]
    min_tokens = 1 if allow_single_token else 2
    if len(tokens) < min_tokens or len(tokens) > 5:
        return False
    if any(len(token) < 2 for token in tokens):
        return False
    if max(len(token) for token in tokens) < 4:
        return False
    blocked_tokens = {
        "government",
        "india",
        "passport",
        "address",
        "female",
        "male",
        "sex",
        "dob",
        "birth",
        "aadhaar",
        "driving",
        "licence",
        "license",
        "year",
        "signature",
        "authority",
        "card",
        "unique",
        "identification",
        "issued",
        "downloaded",
        "verified",
        "father",
        "mother",
        "husband",
        "wife",
        "care",
    }
    if any(token.lower() in blocked_tokens for token in tokens):
        return False
    if any(sum(1 for ch in token.lower() if ch in "aeiou") == 0 for token in tokens):
        return False
    short_tokens = sum(1 for token in tokens if len(token) <= 2)
    if short_tokens > (1 if allow_single_token else 0):
        return False
    vowel_count = sum(1 for ch in candidate.lower() if ch in "aeiou")
    return vowel_count >= max(2, len(tokens))


def _extract_generic_name(lines: list[str]) -> Optional[str]:
    label_patterns = [
        r"(?:name|name of card holder|holder name|given name|surname)\s*[:\-]\s*([A-Za-z][A-Za-z\s\.]{2,})",
        r"(?:name|name of card holder|holder name|given name|surname)\s+([A-Za-z][A-Za-z\s\.]{2,})",
    ]
    for idx, line in enumerate(lines):
        for pattern in label_patterns:
            match = re.search(pattern, line, re.IGNORECASE)
            if match:
                candidate = _extract_best_name_from_line(match.group(1).replace(".", " "))
                if _is_plausible_name(candidate):
                    return candidate

        lower_line = line.lower()
        if re.fullmatch(r"(name|holder name|given name|surname)\s*[:\-]?", lower_line):
            if idx + 1 < len(lines):
                candidate = _extract_best_name_from_line(lines[idx + 1])
                if _is_plausible_name(candidate):
                    return candidate

    scored_candidates: list[tuple[int, str]] = []
    for idx, line in enumerate(lines):
        candidate = _extract_best_name_from_line(line)
        if not _is_plausible_name(candidate):
            continue
        score = 0
        token_count = len(candidate.split())
        if 2 <= token_count <= 4:
            score += 3
        if 8 <= len(candidate) <= 32:
            score += 2
        neighbor_text = " ".join(lines[max(0, idx - 1): min(len(lines), idx + 2)]).lower()
        if re.search(r"\b(dob|yob|male|female|gender)\b", neighbor_text):
            score += 2
        scored_candidates.append((score, candidate))

    if scored_candidates:
        scored_candidates.sort(key=lambda item: (item[0], len(item[1])), reverse=True)
        return scored_candidates[0][1]

    return None


def _extract_aadhaar_name(lines: list[str]) -> Optional[str]:
    anchors = []
    for idx, line in enumerate(lines):
        lowered = line.lower()
        if re.search(r"\b(dob|yob|year of birth|male|female|gender|aadhaar|uidai|government of india)\b", lowered):
            anchors.append(idx)

    anchor_candidates: list[tuple[int, str]] = []
    for anchor in anchors:
        for offset, weight in ((-1, 12), (-2, 6), (0, 3), (1, 1)):
            idx = anchor + offset
            if idx < 0 or idx >= len(lines):
                continue
            candidate = _extract_best_name_from_line(lines[idx])
            if not _is_plausible_name(candidate):
                continue
            candidate_score = _score_name_candidate(candidate) + weight
            if offset == -1:
                candidate_score += 4
            anchor_candidates.append((candidate_score, candidate))

    if anchor_candidates:
        anchor_candidates.sort(key=lambda item: (item[0], len(item[1])), reverse=True)
        return anchor_candidates[0][1]

    scored_candidates: list[tuple[int, str]] = []
    for idx, line in enumerate(lines):
        candidate = _extract_best_name_from_line(line)
        if not _is_plausible_name(candidate):
            continue
        score = 0
        if 2 <= len(candidate.split()) <= 4:
            score += 4
        if 8 <= len(candidate) <= 30:
            score += 2
        if any(abs(idx - anchor) <= 1 for anchor in anchors):
            score += 4
        if any(abs(idx - anchor) <= 2 for anchor in anchors):
            score += 1
        previous_line = lines[idx - 1].lower() if idx > 0 else ""
        next_line = lines[idx + 1].lower() if idx + 1 < len(lines) else ""
        if re.search(r"\b(government of india|uidai|aadhaar)\b", previous_line):
            score += 3
        if re.search(r"\b(dob|yob|year of birth|male|female|gender)\b", next_line):
            score += 4
        if re.search(r"\b(s/o|d/o|w/o|c/o)\b", line.lower()):
            score -= 4
        if score >= 5:
            scored_candidates.append((score + _score_name_candidate(candidate), candidate))

    if scored_candidates:
        scored_candidates.sort(key=lambda item: (item[0], len(item[1])), reverse=True)
        return scored_candidates[0][1]

    return _extract_generic_name(lines)


def _prepare_text_lines(text: str) -> list[str]:
    raw_lines = [line.strip() for line in (text or "").splitlines() if line.strip()]
    cleaned_lines: list[str] = []
    for line in raw_lines:
        cleaned = _normalize_whitespace(re.sub(r"[^A-Za-z0-9\s:./-]", " ", line))
        if cleaned:
            cleaned_lines.append(cleaned)
    return cleaned_lines


def _extract_name_near_birth_anchor(text: str) -> Optional[str]:
    cleaned_text = _normalize_whitespace(re.sub(r"[^A-Za-z0-9\s:/.-]", " ", text or ""))
    match = re.search(
        r"([A-Za-z]{2,}(?:\s+[A-Za-z]{2,}){1,3})\s*(?:[:|./-]\s*)?(?:dob|yob|year of birth)\b",
        cleaned_text,
        re.IGNORECASE,
    )
    if not match:
        return None

    candidate = _extract_best_name_from_line(match.group(1))
    if _is_plausible_name(candidate):
        return candidate
    return None


def parse_identity_fields(raw_text: str) -> dict:
    text = raw_text or ""
    initial_document_number = _extract_document_number(text)
    initial_document_type = _infer_document_type(text, initial_document_number)
    document_number = _extract_document_number(text, initial_document_type)
    document_type = _infer_document_type(text, document_number or initial_document_number)
    date_of_birth = _extract_date_of_birth(text)
    year_of_birth = _extract_year_of_birth(text)

    lines = _prepare_text_lines(text)
    if document_type == "AADHAAR":
        full_name = _extract_aadhaar_name(lines)
    else:
        full_name = _extract_generic_name(lines)
    if not full_name:
        full_name = _extract_name_near_birth_anchor(text)

    return {
        "fullName": full_name,
        "documentNumber": document_number or initial_document_number,
        "dateOfBirth": date_of_birth,
        "yearOfBirth": year_of_birth,
        "documentType": document_type,
    }
