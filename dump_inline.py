from bs4 import BeautifulSoup

with open('treasure.html', 'r', encoding='utf-8') as f:
    html = f.read()

soup = BeautifulSoup(html, 'html.parser')
scripts = soup.find_all('script')

with open('script3.txt', 'w', encoding='utf-8') as f:
    f.write(scripts[3].string)
