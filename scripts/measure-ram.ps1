<#
.SYNOPSIS
  Measures Ideal's RAM (WorkingSet) including all descendant processes (msedgewebview2, PTY children).
  Exit code 1 if total >= 250 MB or the Ideal main process >= 50 MB.
#>
param([string]$ProcessName = 'ideal')

$TotalBudgetMB = 250
$MainBudgetMB = 50
$Excluded = @('claude*', 'pwsh*', 'powershell*', 'cmd*', 'conhost*', 'OpenConsole*')

$all = Get-CimInstance Win32_Process
$byParent = $all | Group-Object ParentProcessId -AsHashTable -AsString
$mains = @($all | Where-Object { $_.Name -like "$ProcessName.exe" })
if ($mains.Count -eq 0) {
  Write-Host "Processo '$ProcessName' non trovato."
  exit 2
}

function Test-Excluded($name) {
  foreach ($p in $Excluded) { if ($name -like "$p.exe" -or $name -like $p) { return $true } }
  return $false
}

# Walk descendants; an excluded process is skipped together with its whole subtree
# (e.g. node.exe spawned by claude).
$rows = New-Object System.Collections.Generic.List[object]
$seen = New-Object System.Collections.Generic.HashSet[uint32]
function Walk($proc, $isMain) {
  if (-not $seen.Add([uint32]$proc.ProcessId)) { return }
  $mb = [math]::Round(([double]$proc.WorkingSetSize) / 1MB, 1)
  $rows.Add([pscustomobject]@{ PID = $proc.ProcessId; Name = $proc.Name; MB = $mb; Main = $isMain })
  foreach ($c in @($byParent["$($proc.ProcessId)"])) {
    if ($null -eq $c) { continue }
    if (Test-Excluded $c.Name) { continue }
    # PID reuse guard: a real child cannot predate its parent.
    if ($c.CreationDate -lt $proc.CreationDate) { continue }
    Walk $c $false
  }
}
foreach ($m in $mains) { Walk $m $true }

$rows | Sort-Object MB -Descending | Format-Table PID, Name, MB -AutoSize

$total = [math]::Round(($rows | Measure-Object MB -Sum).Sum, 1)
$main = [math]::Round(($rows | Where-Object Main | Measure-Object MB -Sum).Sum, 1)
$web = [math]::Round([double](($rows | Where-Object { $_.Name -like 'msedgewebview2*' } | Measure-Object MB -Sum).Sum), 1)

Write-Host "Totale:          $total MB (budget < $TotalBudgetMB)"
Write-Host "Ideal main:      $main MB (budget < $MainBudgetMB)"
Write-Host "msedgewebview2:  $web MB"

if ($total -ge $TotalBudgetMB -or $main -ge $MainBudgetMB) {
  Write-Host 'FUORI BUDGET'
  exit 1
}
Write-Host 'OK'
exit 0
