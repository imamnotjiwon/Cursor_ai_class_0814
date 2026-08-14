# QR 코드 만들기

원하는 URL을 넣고, 색과 모양을 골라 QR 코드를 만드는 Streamlit 웹앱입니다. 여러 주소를 한 번에 만든 뒤 PNG 또는 ZIP으로 받을 수 있습니다.

## 실행 방법

```bash
cd qrcode
pip install -r requirements.txt
streamlit run app.py
```

브라우저가 열리면 주소를 입력하고 **만들기**를 누르세요. 여러 주소는 한 줄에 하나씩 넣으면 됩니다.

## 기능

- 원형, 라운드, 도트 등 QR 모양 선택
- 색상 프리셋과 직접 고르는 QR/배경/테두리 색
- 가운데 로고, 원 테두리 두께, 투명 배경
- QR 아래에 주소 표시
- 개별 PNG 저장, 전체 ZIP 다운로드
