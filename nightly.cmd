@echo off
REM Chot so chi tieu hang dem. Duoc Windows Task Scheduler goi.
REM
REM Phai chay sync truoc daily: daily loc tai khoan theo amount_spent > 0, ma cot do
REM chi duoc cap nhat boi sync. Tai khoan moi tieu tien lan dau se bi bo qua neu
REM chay nguoc thu tu.

cd /d "%~dp0"
if not exist data mkdir data

echo. >> data\nightly.log
echo ======== BAT DAU %date% %time% ======== >> data\nightly.log

call npm run sync >> data\nightly.log 2>&1
call npm run daily >> data\nightly.log 2>&1

echo ======== XONG %date% %time% ======== >> data\nightly.log
