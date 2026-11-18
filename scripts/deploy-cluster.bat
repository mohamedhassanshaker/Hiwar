@echo off
rem Build the images, push them to the kind registry, migrate the database and roll out,
rem by running scripts\deploy-cluster.sh in Git Bash.
rem
rem   scripts\deploy-cluster.bat              web and agent
rem   scripts\deploy-cluster.bat web          one of them: web, agent or connectors
rem   set ALLOW_IN_FLIGHT=1                   then run it, to deploy over missions still running
rem
rem Needs Docker, kind, kubectl, helm and curl on PATH. C:\Windows\System32\bash.exe is WSL,
rem not Git Bash, so Git Bash is found from git.exe, or named by GIT_BASH.
setlocal

if defined GIT_BASH if exist "%GIT_BASH%" goto run
set "GIT_BASH="
for /f "delims=" %%G in ('where git.exe 2^>nul') do (
  if not defined GIT_BASH if exist "%%~dpG..\bin\bash.exe" set "GIT_BASH=%%~dpG..\bin\bash.exe"
  if not defined GIT_BASH if exist "%%~dpG..\..\bin\bash.exe" set "GIT_BASH=%%~dpG..\..\bin\bash.exe"
)
if not defined GIT_BASH if exist "%ProgramFiles%\Git\bin\bash.exe" set "GIT_BASH=%ProgramFiles%\Git\bin\bash.exe"
if not defined GIT_BASH (
  echo deploy-cluster: Git Bash was not found. Install Git for Windows or set GIT_BASH to its bin\bash.exe. 1>&2
  exit /b 1
)

:run
pushd "%~dp0.."
"%GIT_BASH%" scripts/deploy-cluster.sh %*
set "status=%ERRORLEVEL%"
popd
if not "%status%"=="0" echo deploy-cluster: failed with exit code %status%. 1>&2
exit /b %status%
