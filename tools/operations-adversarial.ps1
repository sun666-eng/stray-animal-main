param([string]$BaseUrl="http://localhost:9999",[string]$UserName="jerry",[string]$UserPass="123456",[string]$AdminName="admin",[string]$AdminPass="admin")
$ErrorActionPreference="Stop"; . "$PSScriptRoot\lib-session.ps1"; $fail=0; $pass=0
function Check($name,$ok,$detail){if($ok){$script:pass++;Write-Host "[PASS] $name :: $detail" -ForegroundColor Green}else{$script:fail++;Write-Host "[FAIL] $name :: $detail" -ForegroundColor Red}}
function Code($r){if($r.Json){return [string]$r.Json.code};return [string]$r.StatusCode}
$user=New-AppSession -BaseUrl $BaseUrl -Username $UserName -Password $UserPass
$admin=New-AppSession -BaseUrl $BaseUrl -Username $AdminName -Password $AdminPass

# Anonymous medical history is public-filtered, while favorites remain account-owned.
try{$med=Invoke-WebRequest -Uri "$BaseUrl/api/operations/animals/10011/medical" -UseBasicParsing;Check "anonymous public medical" ($med.StatusCode -eq 200 -and $med.Content -match '"code":"0"') "http=$($med.StatusCode)"}catch{Check "anonymous public medical" $false $_.Exception.Message}
try{$fav=Invoke-WebRequest -Uri "$BaseUrl/api/operations/favorites" -UseBasicParsing;Check "anonymous favorites denied" $false "http=$($fav.StatusCode)"}catch{$st=[int]$_.Exception.Response.StatusCode;Check "anonymous favorites denied" ($st -eq 401) "http=$st"}

# Ordinary user cannot cross the controller's operational permission boundary.
$forbidden=Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/operations/admin/volunteer-tasks" -AppSession $user -Method POST -BodyObject @{title="越权";startAt="2030-01-01T10:00";endAt="2030-01-01T11:00";capacity=1;status=0}
Check "ordinary user cannot create task" ((Code $forbidden) -eq "403") "code=$(Code $forbidden)"

# Favorite writes are idempotent and owner-scoped.
$animals=Invoke-RestMethod -Uri "$BaseUrl/api/animal/page1?pageNum=1&pageSize=1" -Method GET
$animalId=$animals.data.records[0].id
$a1=Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/operations/favorites/$animalId" -AppSession $user -Method POST -BodyObject @{}
$a2=Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/operations/favorites/$animalId" -AppSession $user -Method POST -BodyObject @{}
$mine=Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/operations/favorites" -AppSession $user -Method GET
Check "favorite add idempotent" ((Code $a1)-eq"0" -and (Code $a2)-eq"0" -and @($mine.Json.data|Where-Object{$_.id -eq $animalId}).Count -eq 1) "animal=$animalId"
$d1=Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/operations/favorites/$animalId" -AppSession $user -Method DELETE
$d2=Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/operations/favorites/$animalId" -AppSession $user -Method DELETE
Check "favorite remove idempotent" ((Code $d1)-eq"0" -and (Code $d2)-eq"0") "codes=$(Code $d1),$(Code $d2)"

# Admin creates a draft, publishes with optimistic locking, stale replay fails, then cancels test data.
$stamp=[DateTimeOffset]::Now.ToUnixTimeMilliseconds();$body=@{title="[AUDIT-$stamp] 对抗测试任务";description="自动化测试；已取消归档";location="测试环境";startAt="2030-01-01T10:00";endAt="2030-01-01T11:00";capacity=1;status=0}
$created=Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/operations/admin/volunteer-tasks" -AppSession $admin -Method POST -BodyObject $body
$taskId=$created.Json.data;Check "admin creates task" ((Code $created)-eq"0" -and [long]$taskId -gt 0) "id=$taskId"
$publish=Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/operations/admin/volunteer-tasks/$taskId/status" -AppSession $admin -Method PUT -BodyObject @{status=1;expectedVersion=0}
$stale=Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/operations/admin/volunteer-tasks/$taskId/status" -AppSession $admin -Method PUT -BodyObject @{status=2;expectedVersion=0}
Check "task optimistic lock rejects stale write" ((Code $publish)-eq"0" -and (Code $stale)-eq"409") "publish=$(Code $publish) stale=$(Code $stale)"
$cancel=Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/operations/admin/volunteer-tasks/$taskId/status" -AppSession $admin -Method PUT -BodyObject @{status=3;expectedVersion=1}
Check "test task safely cancelled" ((Code $cancel)-eq"0") "code=$(Code $cancel)"

$signup=Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/operations/volunteer-tasks/$taskId/signup" -AppSession $user -Method POST -BodyObject @{note="越过资格或任务状态"}
Check "invalid signup denied" ((Code $signup)-in @("403","409")) "code=$(Code $signup)"

# Full happy path on an approved volunteer (jerry in the development fixture).
$flow=Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/operations/admin/volunteer-tasks" -AppSession $admin -Method POST -BodyObject @{title="[FLOW-$stamp] 服务闭环测试";description="对抗审查形成的完成记录";location="测试环境";startAt="2030-02-01T10:00";endAt="2030-02-01T12:00";capacity=1;status=1}
$flowId=$flow.Json.data
$sg1=Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/operations/volunteer-tasks/$flowId/signup" -AppSession $user -Method POST -BodyObject @{note="可以参加"}
$sg2=Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/operations/volunteer-tasks/$flowId/signup" -AppSession $user -Method POST -BodyObject @{note="重复提交"}
Check "approved volunteer signup idempotent" ((Code $sg1)-eq"0" -and $sg1.Json.data -eq $sg2.Json.data) "signup=$($sg1.Json.data)"
$signupId=$sg1.Json.data
$as1=Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/operations/admin/volunteer-signups/$signupId/assign" -AppSession $admin -Method PUT -BodyObject @{accepted=$true;expectedVersion=0}
$as2=Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/operations/admin/volunteer-signups/$signupId/assign" -AppSession $admin -Method PUT -BodyObject @{accepted=$true;expectedVersion=0}
Check "assignment retry idempotent" ((Code $as1)-eq"0" -and (Code $as2)-eq"0") "codes=$(Code $as1),$(Code $as2)"
$done1=Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/operations/admin/volunteer-signups/$signupId/complete" -AppSession $admin -Method POST -BodyObject @{expectedVersion=1;serviceMinutes=120;summary="完成测试现场服务"}
$done2=Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/operations/admin/volunteer-signups/$signupId/complete" -AppSession $admin -Method POST -BodyObject @{expectedVersion=1;serviceMinutes=120;summary="响应丢失重试"}
$rows=Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/operations/admin/volunteer-tasks/$flowId/signups" -AppSession $admin -Method GET
$serviceRows=@($rows.Json.data|Where-Object{$_.id -eq $signupId -and $_.status -eq 2 -and $_.service_minutes -eq 120})
Check "service completion retry creates one record" ((Code $done1)-eq"0" -and (Code $done2)-eq"0" -and $serviceRows.Count -eq 1) "rows=$($serviceRows.Count)"
$closed=Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/operations/admin/volunteer-tasks/$flowId/status" -AppSession $admin -Method PUT -BodyObject @{status=2;expectedVersion=0}
Check "completed test task closed" ((Code $closed)-eq"0") "code=$(Code $closed)"

$work=Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/operations/admin/work-items" -AppSession $admin -Method GET
$summary=Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/operations/admin/work-items/summary" -AppSession $admin -Method GET
Check "unified work queue readable" ((Code $work)-eq"0" -and (Code $summary)-eq"0" -and $summary.Json.data.open -ge 0) "open=$($summary.Json.data.open)"

$badMedical=Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/operations/admin/animals/10011/medical" -AppSession $admin -Method POST -BodyObject @{recordType="exam";title="bad";content="x";occurredAt="2026-07-29T12:00";visibility="everyone"}
Check "medical visibility allowlist" ((Code $badMedical)-eq"400") "code=$(Code $badMedical)"

Write-Host "=== operations adversarial result: pass=$pass fail=$fail ===";if($fail -gt 0){exit 1}
