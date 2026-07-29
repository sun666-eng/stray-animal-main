param(
    [string]$BaseUrl = "http://localhost:9999",
    [string]$UserName = "jerry",
    [string]$UserPass = "123456",
    [string]$AdminName = "admin",
    [string]$AdminPass = "admin"
)

$ErrorActionPreference = "Stop"
$script:Passed = 0

function Assert-Status([string]$Label, [int]$Actual, [int]$Expected) {
    if ($Actual -ne $Expected) { throw "$Label expected HTTP $Expected but received $Actual" }
    $script:Passed += 1
    Write-Host "[PASS] $Label -> HTTP $Actual"
}

function Invoke-Status([string]$Method, [string]$Url, $Body, $Session, [string]$CsrfToken = "") {
    try {
        $params = @{ Uri = $Url; Method = $Method; ContentType = "application/json"; TimeoutSec = 10 }
        if ($null -ne $Body) { $params.Body = ($Body | ConvertTo-Json -Compress) }
        if ($null -ne $Session) { $params.WebSession = $Session }
        if ($CsrfToken) { $params.Headers = @{ "X-CSRF-Token" = $CsrfToken } }
        $response = Invoke-WebRequest @params
        return [int]$response.StatusCode
    } catch {
        if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
        throw
    }
}

function Login([string]$Name, [string]$Pass) {
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $response = Invoke-RestMethod -Uri "$BaseUrl/api/user/login" -Method Post -ContentType "application/json" `
        -Body (@{ username = $Name; password = $Pass } | ConvertTo-Json -Compress) -WebSession $session -TimeoutSec 10
    if ($response.code -ne "0" -or -not $response.data.csrfToken) { throw "login $Name did not return an authenticated CSRF token" }
    $script:Passed += 1
    Write-Host "[PASS] login $Name -> authenticated session + CSRF token"
    return @{ Session = $session; Token = [string]$response.data.csrfToken }
}

$path = "$BaseUrl/api/admin-agent/adoption-drafts/9999999999/finalize"
$validShape = @{
    requestId = "phase3b_anonymous_probe"
    expectedVersion = 1
    decision = "approve"
    overrideReason = ""
    reviewedApplication = $true
    acknowledgeConsequences = $true
}

Assert-Status "anonymous finalize denied" (Invoke-Status "POST" $path $validShape $null) 401

$userAuth = Login $UserName $UserPass
$userShape = $validShape.Clone(); $userShape.requestId = "phase3b_user_probe"
Assert-Status "ordinary user finalize denied" (Invoke-Status "POST" $path $userShape $userAuth.Session $userAuth.Token) 403

$adminAuth = Login $AdminName $AdminPass
$missingReview = $validShape.Clone(); $missingReview.requestId = "phase3b_ack_probe"; $missingReview.reviewedApplication = $false
Assert-Status "missing human review rejected before lookup" (Invoke-Status "POST" $path $missingReview $adminAuth.Session $adminAuth.Token) 400

$invalidDecision = $validShape.Clone(); $invalidDecision.requestId = "phase3b_decision_probe"; $invalidDecision.decision = "delete"
Assert-Status "invalid final decision rejected" (Invoke-Status "POST" $path $invalidDecision $adminAuth.Session $adminAuth.Token) 400

$missingDraft = $validShape.Clone(); $missingDraft.requestId = "phase3b_missing_probe"
Assert-Status "nonexistent owned draft fails closed" (Invoke-Status "POST" $path $missingDraft $adminAuth.Session $adminAuth.Token) 404

Write-Host "admin-agent-phase3b-adversarial: PASS ($script:Passed checks)"
