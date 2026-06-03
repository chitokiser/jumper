@echo off
chcp 65001 > nul
REM .env 파일에서 환경변수 로드 후 봇 실행
REM 사용법: .env.example 을 .env 로 복사하고 실제 값 입력 후 이 파일 실행

if not exist .env (
    echo [ERROR] .env 파일이 없습니다.
    echo .env.example 을 복사해서 .env 를 만들고 값을 채워주세요.
    pause
    exit /b 1
)

REM .env 파일 로드
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if not "%%A"=="" if not "%%A:~0,1%"=="#" set "%%A=%%B"
)

python bot.py
pause
