# 共享登录会话：仅 Session Cookie + CSRF（浏览器已取消 JWT）

function New-AppSession {
  param(
    [Parameter(Mandatory = $true)][string]$BaseUrl,
    [Parameter(Mandatory = $true)][string]$Username,
    [Parameter(Mandatory = $true)][string]$Password
  )
  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $body = @{ username = $Username; password = $Password } | ConvertTo-Json
  $login = Invoke-RestMethod -Uri "$BaseUrl/api/user/login" -Method POST `
    -ContentType "application/json; charset=utf-8" -Body $body -WebSession $session
  if ($login.code -ne "0") {
    throw "login failed code=$($login.code) msg=$($login.msg)"
  }
  $csrf = $null
  if ($login.data -and $login.data.csrfToken) {
    $csrf = $login.data.csrfToken
  } else {
    try {
      $c = Invoke-RestMethod -Uri "$BaseUrl/api/user/csrf" -Method GET -WebSession $session
      if ($c.code -eq "0" -and $c.data.csrfToken) { $csrf = $c.data.csrfToken }
    } catch {}
  }
  # 对抗：登录响应不得再含 token（Session 唯一权威）
  if ($login.data -and $login.data.PSObject.Properties.Name -contains "token" -and $login.data.token) {
    throw "login must not return JWT token for browser auth"
  }
  return [pscustomobject]@{
    Session  = $session
    Login    = $login
    Token    = $null
    Csrf     = $csrf
    User     = $(if ($login.data) { $login.data.user } else { $null })
  }
}

function Get-AuthHeaders {
  param(
    $AppSession,
    [switch]$Json
  )
  $h = @{}
  if ($Json) { $h["Content-Type"] = "application/json; charset=utf-8" }
  if ($AppSession.Csrf) { $h["X-CSRF-Token"] = $AppSession.Csrf }
  return $h
}

function Clear-AppSessionStickyHeaders {
  param($AppSession)
  if (-not $AppSession -or -not $AppSession.Session -or -not $AppSession.Session.Headers) { return }
  foreach ($k in @("Authorization", "X-CSRF-Token", "Content-Type", "X-Requested-With")) {
    if ($AppSession.Session.Headers.ContainsKey($k)) {
      $AppSession.Session.Headers.Remove($k) | Out-Null
    }
  }
}

function Invoke-ApiJson {
  param(
    [Parameter(Mandatory = $true)][string]$BaseUrl,
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)]$AppSession,
    [ValidateSet("GET","POST","PUT","DELETE","PATCH")][string]$Method = "GET",
    $BodyObject = $null
  )
  $uri = "$BaseUrl$Path"
  $headers = Get-AuthHeaders -AppSession $AppSession -Json:($Method -ne "GET")
  $params = @{
    Uri         = $uri
    Method      = $Method
    WebSession  = $AppSession.Session
    Headers     = $headers
    UseBasicParsing = $true
  }
  if ($null -ne $BodyObject -and $Method -ne "GET") {
    $params.Body = ($BodyObject | ConvertTo-Json -Compress -Depth 6)
  }
  try {
    $resp = Invoke-WebRequest @params
    Clear-AppSessionStickyHeaders -AppSession $AppSession
    $json = $null
    try { $json = $resp.Content | ConvertFrom-Json } catch {}
    return [pscustomobject]@{
      StatusCode = [int]$resp.StatusCode
      Json       = $json
      Content    = $resp.Content
      Ok         = $true
    }
  } catch {
    Clear-AppSessionStickyHeaders -AppSession $AppSession
    $status = 0
    $content = ""
    $json = $null
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
      try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $content = $reader.ReadToEnd()
        $json = $content | ConvertFrom-Json
      } catch {}
    }
    return [pscustomobject]@{
      StatusCode = $status
      Json       = $json
      Content    = $content
      Ok         = $false
      Error      = $_.Exception.Message
    }
  }
}
