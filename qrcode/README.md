# QR 코드 만들기

원하는 URL을 넣고, 색과 모양을 골라 QR 코드를 만드는 Streamlit 웹앱입니다. 여러 주소를 한 번에 만든 뒤 PNG 또는 ZIP으로 받을 수 있습니다.

GitHub는 코드를 올려 두는 곳이라, 이 페이지에서 앱이 바로 켜지지는 않습니다. 아래 순서대로 내 컴퓨터에서 실행하면 됩니다.

## 실행 방법

1. 저장소를 내 컴퓨터로 받습니다.

```bash
git clone https://github.com/imamnotjiwon/Cursor_ai_class_0814.git
cd Cursor_ai_class_0814/qrcode
```

2. 필요한 라이브러리를 설치합니다.

```bash
pip install -r requirements.txt
```

3. 앱을 실행합니다.

```bash
streamlit run app.py
```

브라우저가 열리면 주소를 입력하고 **만들기**를 누르세요. 여러 주소는 한 줄에 하나씩 넣으면 됩니다.

이미 이 폴더를 컴퓨터에 받아 둔 경우에는 1번을 건너뛰고, `qrcode` 폴더에서 2~3번만 하면 됩니다.

## 기능

- 원형, 라운드, 도트 등 QR 모양 선택
- 색상 프리셋과 직접 고르는 QR/배경/테두리 색
- 가운데 로고, 원 테두리 두께, 투명 배경
- QR 아래에 주소 표시
- 개별 PNG 저장, 전체 ZIP 다운로드
