$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$speechEngine = $null
$audioStream = New-Object IO.MemoryStream
try {
    Add-Type -AssemblyName System.Speech
    $recognizer = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() |
        Where-Object { $_.Culture.Name -eq 'zh-TW' } | Select-Object -First 1
    if (!$recognizer) { throw 'Windows 尚未安裝繁體中文（臺灣）語音辨識引擎。' }
    $speechEngine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($recognizer.Id)
    $speechEngine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
    $speechEngine.InitialSilenceTimeout = [TimeSpan]::FromMinutes(5)
    [Console]::OpenStandardInput().CopyTo($audioStream)
    $audioStream.Position = 0
    $speechEngine.SetInputToWaveStream($audioStream)
    $segments = New-Object 'Collections.Generic.List[string]'
    Register-ObjectEvent -InputObject $speechEngine -EventName SpeechRecognized -SourceIdentifier KSpeechRecognized | Out-Null
    Register-ObjectEvent -InputObject $speechEngine -EventName RecognizeCompleted -SourceIdentifier KSpeechCompleted | Out-Null
    $speechEngine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
    while ($true) {
        $speechEvent = Wait-Event
        Remove-Event -EventIdentifier $speechEvent.EventIdentifier
        if ($speechEvent.SourceIdentifier -eq 'KSpeechRecognized') { $segments.Add($speechEvent.SourceEventArgs.Result.Text) }
        if ($speechEvent.SourceIdentifier -eq 'KSpeechCompleted') {
            if ($speechEvent.SourceEventArgs.Error) { throw $speechEvent.SourceEventArgs.Error }
            break
        }
    }
    [Console]::WriteLine((@{ok=$true; text=($segments -join '')} | ConvertTo-Json -Compress))
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
} finally {
    Get-EventSubscriber | Unregister-Event
    if ($speechEngine) { $speechEngine.Dispose() }
    $audioStream.Dispose()
}
