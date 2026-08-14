import io
import os
import re
import tempfile
import zipfile
from dataclasses import dataclass
from urllib.parse import urlparse

import qrcode
import streamlit as st
from PIL import Image, ImageDraw, ImageFont, ImageOps
from qrcode.image.styledpil import StyledPilImage
from qrcode.image.styles.colormasks import RadialGradiantColorMask, SolidFillColorMask
from qrcode.image.styles.moduledrawers.pil import (
    CircleModuleDrawer,
    GappedSquareModuleDrawer,
    HorizontalBarsDrawer,
    RoundedModuleDrawer,
    SquareModuleDrawer,
    VerticalBarsDrawer,
)

URL_PATTERN = re.compile(r"^https?://", re.IGNORECASE)
RENDER_SCALE = 2
KOREAN_FONT = "C:/Windows/Fonts/malgun.ttf"

STYLE_OPTIONS = {
    "원형 (추천)": {
        "help": "점 모듈과 굵은 원 테두리.",
        "kind": "circular",
    },
    "라운드": {
        "help": "모서리가 부드러운 연결형.",
        "kind": "styled",
        "module": "rounded",
        "eye": "rounded",
    },
    "도트": {
        "help": "점을 찍은 듯한 원형 모듈.",
        "kind": "styled",
        "module": "circle",
        "eye": "rounded",
    },
    "간격 사각형": {
        "help": "모듈 사이에 틈이 있는 미니멀 스타일.",
        "kind": "styled",
        "module": "gapped",
        "eye": "square",
    },
    "세로 바": {
        "help": "세로 줄무늬처럼 이어진 형태.",
        "kind": "styled",
        "module": "vbar",
        "eye": "rounded",
    },
    "가로 바": {
        "help": "가로 줄무늬처럼 이어진 형태.",
        "kind": "styled",
        "module": "hbar",
        "eye": "rounded",
    },
    "기본 사각형": {
        "help": "가장 일반적인 QR. 작은 인쇄에 안전합니다.",
        "kind": "styled",
        "module": "square",
        "eye": "square",
    },
}

COLOR_PRESETS = {
    "블랙": "#111111",
    "네이비": "#1E3A5F",
    "블루": "#2563EB",
    "그린": "#0F766E",
    "레드": "#B91C1C",
    "퍼플": "#6D28D9",
}


@dataclass
class QrOptions:
    style: dict
    box_size: int
    border: int
    fill: str
    back: str
    ring: str
    ring_scale: float
    use_gradient: bool
    logo: Image.Image | None
    transparent: bool
    show_label: bool


def hex_to_rgb(color: str) -> tuple[int, int, int]:
    value = color.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def make_drawer(kind: str):
    drawers = {
        "square": SquareModuleDrawer(),
        "rounded": RoundedModuleDrawer(),
        "circle": CircleModuleDrawer(),
        "gapped": GappedSquareModuleDrawer(size_ratio=0.8),
        "vbar": VerticalBarsDrawer(),
        "hbar": HorizontalBarsDrawer(),
    }
    return drawers[kind]


def normalize_url(raw: str) -> str:
    text = raw.strip()
    if not text:
        return ""
    if not URL_PATTERN.match(text):
        return f"https://{text}"
    return text


def is_valid_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def parse_urls(text: str) -> list[str]:
    seen: set[str] = set()
    urls: list[str] = []
    for line in text.splitlines():
        url = normalize_url(line)
        if not url or url in seen:
            continue
        seen.add(url)
        urls.append(url)
    return urls


def is_in_finder(row: int, col: int, size: int) -> bool:
    in_top_left = row < 8 and col < 8
    in_top_right = row < 8 and col >= size - 8
    in_bottom_left = row >= size - 8 and col < 8
    return in_top_left or in_top_right or in_bottom_left


def is_in_center(row: int, col: int, size: int, ratio: float) -> bool:
    center = (size - 1) / 2
    radius = size * ratio / 2
    return (row - center) ** 2 + (col - center) ** 2 <= radius**2


def draw_finder(
    draw: ImageDraw.ImageDraw,
    x: float,
    y: float,
    module_px: int,
    front: tuple[int, int, int],
    background: tuple[int, int, int],
) -> None:
    outer = 7 * module_px
    draw.rectangle((x, y, x + outer - 1, y + outer - 1), fill=(*front, 255))
    inset = module_px
    draw.rectangle(
        (x + inset, y + inset, x + outer - 1 - inset, y + outer - 1 - inset),
        fill=(*background, 255),
    )
    inset_core = module_px * 2
    draw.rectangle(
        (
            x + inset_core,
            y + inset_core,
            x + outer - 1 - inset_core,
            y + outer - 1 - inset_core,
        ),
        fill=(*front, 255),
    )


def make_circular_logo(
    logo: Image.Image,
    size: int,
    background: tuple[int, int, int],
) -> Image.Image:
    fitted = ImageOps.fit(logo.convert("RGBA"), (size, size), Image.Resampling.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    fitted.putalpha(mask)

    pad = max(4, size // 10)
    total = size + pad * 2
    badge = Image.new("RGBA", (total, total), (0, 0, 0, 0))
    ImageDraw.Draw(badge).ellipse((0, 0, total - 1, total - 1), fill=(*background, 255))
    badge.paste(fitted, (pad, pad), fitted)
    return badge


def make_circular_qr(url: str, options: QrOptions) -> Image.Image:
    module_px = options.box_size * RENDER_SCALE
    qr = qrcode.QRCode(
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=1,
        border=0,
    )
    qr.add_data(url)
    qr.make(fit=True)
    matrix = qr.modules
    n = len(matrix)
    qr_px = n * module_px

    circum_r = (2 * (qr_px / 2) ** 2) ** 0.5
    gap = module_px * 2.2
    ring_width = max(RENDER_SCALE * 18, int(module_px * options.ring_scale * 2.6))
    outer_r = circum_r + gap + ring_width
    canvas = int(outer_r * 2 + module_px)
    canvas += (RENDER_SCALE - canvas % RENDER_SCALE) % RENDER_SCALE

    front = hex_to_rgb(options.fill)
    background = hex_to_rgb(options.back)
    ring_color = hex_to_rgb(options.ring)
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx = cy = canvas / 2
    inner_r = circum_r + gap

    draw.ellipse(
        (cx - outer_r, cy - outer_r, cx + outer_r, cy + outer_r),
        fill=(*background, 255),
    )

    offset = (canvas - qr_px) / 2
    dot_r = module_px * 0.36
    logo_clear_ratio = 0.24 if options.logo is not None else 0.0

    for row in range(n):
        for col in range(n):
            if not matrix[row][col]:
                continue
            if is_in_finder(row, col, n):
                continue
            if logo_clear_ratio and is_in_center(row, col, n, logo_clear_ratio):
                continue
            x = offset + col * module_px + module_px / 2
            y = offset + row * module_px + module_px / 2
            draw.ellipse((x - dot_r, y - dot_r, x + dot_r, y + dot_r), fill=(*front, 255))

    for row, col in ((0, 0), (0, n - 7), (n - 7, 0)):
        draw_finder(
            draw,
            offset + col * module_px,
            offset + row * module_px,
            module_px,
            front,
            background,
        )

    if options.logo is not None:
        logo_px = max(24 * RENDER_SCALE, int(qr_px * 0.2))
        badge = make_circular_logo(options.logo, logo_px, background)
        img.paste(badge, (int(cx - badge.width / 2), int(cy - badge.height / 2)), badge)

    ring = Image.new("RGBA", (canvas, canvas), (*ring_color, 255))
    ring_mask = Image.new("L", (canvas, canvas), 0)
    ring_draw = ImageDraw.Draw(ring_mask)
    ring_draw.ellipse((cx - outer_r, cy - outer_r, cx + outer_r, cy + outer_r), fill=255)
    ring_draw.ellipse((cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r), fill=0)
    img.paste(ring, (0, 0), ring_mask)

    img = img.resize((canvas // RENDER_SCALE, canvas // RENDER_SCALE), Image.Resampling.LANCZOS)
    if options.transparent:
        return img

    solid = Image.new("RGB", img.size, background)
    solid.paste(img, mask=img.split()[-1])
    return solid


def make_styled_qr(url: str, options: QrOptions) -> Image.Image:
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=options.box_size,
        border=options.border,
    )
    qr.add_data(url)
    qr.make(fit=True)

    front = hex_to_rgb(options.fill)
    background = hex_to_rgb(options.back)
    if options.use_gradient:
        color_mask = RadialGradiantColorMask(
            back_color=background,
            center_color=front,
            edge_color=tuple(max(0, channel - 80) for channel in front),
        )
    else:
        color_mask = SolidFillColorMask(back_color=background, front_color=front)

    kwargs = {
        "image_factory": StyledPilImage,
        "module_drawer": make_drawer(options.style["module"]),
        "eye_drawer": make_drawer(options.style["eye"]),
        "color_mask": color_mask,
    }

    tmp_path = None
    if options.logo is not None:
        fd, tmp_path = tempfile.mkstemp(suffix=".png")
        os.close(fd)
        options.logo.convert("RGBA").save(tmp_path, "PNG")
        kwargs["embedded_image_path"] = tmp_path

    try:
        image = qr.make_image(**kwargs)
    finally:
        if tmp_path:
            os.remove(tmp_path)

    return image.convert("RGB")


def add_label(image: Image.Image, text: str, fill: str, back: str) -> Image.Image:
    rgb = image.convert("RGB")
    padding = 24
    try:
        font = ImageFont.truetype(KOREAN_FONT, 22)
    except OSError:
        font = ImageFont.load_default()

    probe = ImageDraw.Draw(rgb)
    left, top, right, bottom = probe.textbbox((0, 0), text, font=font)
    text_w, text_h = right - left, bottom - top
    canvas_w = max(rgb.width, text_w + padding * 2)
    canvas_h = rgb.height + text_h + padding * 2
    canvas = Image.new("RGB", (canvas_w, canvas_h), hex_to_rgb(back))
    canvas.paste(rgb, ((canvas_w - rgb.width) // 2, padding // 2))
    draw = ImageDraw.Draw(canvas)
    draw.text(
        ((canvas_w - text_w) // 2, rgb.height + padding // 2),
        text,
        fill=hex_to_rgb(fill),
        font=font,
    )
    return canvas


def make_qr(url: str, options: QrOptions) -> Image.Image:
    if options.style["kind"] == "circular":
        image = make_circular_qr(url, options)
    else:
        image = make_styled_qr(url, options)
    if options.show_label:
        return add_label(image, url, options.fill, options.back)
    return image


def image_to_png_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def filename_from_url(url: str, index: int) -> str:
    host = urlparse(url).netloc.replace(".", "_")
    return f"qr_{index:02d}_{host}.png"


def load_logo(uploaded) -> Image.Image | None:
    if uploaded is None:
        return None
    return Image.open(io.BytesIO(uploaded.getvalue())).convert("RGBA")


def init_state() -> None:
    defaults = {
        "fill_color": "#111111",
        "back_color": "#FFFFFF",
        "ring_color": "#111111",
        "results": [],
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def apply_preset(color: str) -> None:
    st.session_state.fill_color = color
    st.session_state.ring_color = color


def render_app() -> None:
    st.set_page_config(
        page_title="QR 코드 만들기",
        page_icon="▣",
        layout="wide",
    )
    init_state()
    st.title("QR 코드 만들기")
    st.caption("원하는 URL을 넣고 색과 모양을 고른 뒤, 만들기를 누르세요. 여러 주소는 한 줄에 하나씩 입력하면 됩니다.")

    left, right = st.columns([1.15, 0.85], gap="large")

    with left:
        urls_text = st.text_area(
            "URL",
            height=140,
            placeholder="https://www.google.com\nhttps://www.naver.com",
            help="한 줄에 주소 하나씩. http/https가 없으면 https를 붙입니다.",
        )

        style_name = st.selectbox("모양", list(STYLE_OPTIONS.keys()))
        style = STYLE_OPTIONS[style_name]
        st.caption(style["help"])

        st.markdown("**색상 프리셋**")
        preset_cols = st.columns(len(COLOR_PRESETS))
        for column, (name, color) in zip(preset_cols, COLOR_PRESETS.items()):
            if column.button(name, use_container_width=True, key=f"preset_{name}"):
                apply_preset(color)
                st.rerun()

        color_cols = st.columns(3 if style["kind"] == "circular" else 2)
        with color_cols[0]:
            fill_color = st.color_picker("QR 색", key="fill_color")
        with color_cols[1]:
            back_color = st.color_picker("배경 색", key="back_color")
        ring_color = fill_color
        if style["kind"] == "circular":
            with color_cols[2]:
                ring_color = st.color_picker("테두리 색", key="ring_color")

        with st.expander("추가 옵션", expanded=False):
            box_size = st.slider("QR 크기", min_value=8, max_value=20, value=12)
            uploaded_logo = st.file_uploader("가운데 로고 (선택)", type=["png", "jpg", "jpeg", "webp"])
            show_label = st.toggle("QR 아래에 주소 표시", value=False)

            border = 3
            use_gradient = False
            ring_scale = 1.2
            transparent = False

            if style["kind"] == "circular":
                ring_scale = st.slider("원 테두리 두께", min_value=0.8, max_value=2.0, value=1.2, step=0.1)
                transparent = st.toggle("원 바깥 투명 배경", value=True)
            else:
                border = st.slider("여백", min_value=2, max_value=8, value=3)
                use_gradient = st.toggle("원형 그라데이션", value=False)

        options = QrOptions(
            style=style,
            box_size=box_size,
            border=border,
            fill=fill_color,
            back=back_color,
            ring=ring_color,
            ring_scale=ring_scale,
            use_gradient=use_gradient,
            logo=load_logo(uploaded_logo),
            transparent=transparent,
            show_label=show_label,
        )

        generate = st.button("만들기", type="primary", use_container_width=True)

    with right:
        st.subheader("미리보기")
        preview_urls = parse_urls(urls_text)
        preview_url = preview_urls[0] if preview_urls else "https://example.com"
        preview = make_qr(preview_url, options)
        st.image(preview, caption=preview_url, use_container_width=True)
        st.caption("왼쪽에서 색과 옵션을 바꾸면 미리보기가 바로 바뀝니다.")

    if generate:
        urls = parse_urls(urls_text)
        if not urls:
            st.warning("URL을 한 줄에 하나씩 입력해 주세요.")
            st.stop()

        invalid = [url for url in urls if not is_valid_url(url)]
        valid = [url for url in urls if is_valid_url(url)]

        if invalid:
            st.error("형식이 올바르지 않은 주소가 있습니다.")
            st.write("\n".join(f"- {item}" for item in invalid))

        if not valid:
            st.stop()

        results = []
        for index, url in enumerate(valid, start=1):
            image = make_qr(url, options)
            png = image_to_png_bytes(image)
            results.append((url, filename_from_url(url, index), png))
        st.session_state.results = results

    results = st.session_state.results
    if not results:
        return

    st.divider()
    st.subheader(f"만든 QR 코드 {len(results)}개")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for _, filename, png in results:
            archive.writestr(filename, png)

    st.download_button(
        label="전체 ZIP 다운로드",
        data=zip_buffer.getvalue(),
        file_name="qr_codes.zip",
        mime="application/zip",
        use_container_width=True,
    )

    columns = st.columns(3)
    for index, (url, filename, png) in enumerate(results):
        with columns[index % 3]:
            st.image(png, caption=url, use_container_width=True)
            st.download_button(
                label="PNG 저장",
                data=png,
                file_name=filename,
                mime="image/png",
                key=f"download_{index}",
                use_container_width=True,
            )


if __name__ == "__main__":
    render_app()
