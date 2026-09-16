from bs4 import BeautifulSoup
import sys

with open('treasure.html', 'r', encoding='utf-8') as f:
    html = f.read()

soup = BeautifulSoup(html, 'html.parser')
scripts = soup.find_all('script')

for i, s in enumerate(scripts):
    if s.get('src'):
        print(f"[{i}] SRC: {s.get('src')}")
    else:
        print(f"[{i}] INLINE LEN: {len(s.string)}")
