#!/usr/bin/env python3
# Spracherkennung des Helfers ohne App nachstellen (Live-Befund 21.10.2026):
#   python3 -I scripts/stt-probe.py file <wav>      → stt.file
#   python3 -I scripts/stt-probe.py stream 0|1     → stt.start (1 = Sprachfilter), spricht per `say` über die Lautsprecher
# Helfer-Binärdatei: ~/.cache/kira-helper-build/release/kira-helper (swift build --scratch-path ~/.cache/kira-helper-build).
# Mit Sprachfilter kommt wegen der Echo-Unterdrückung nur Bruchstück-Text – das ist erwartet; entscheidend ist, OB Text kommt.
import json, subprocess, sys, time, threading, os
helper = os.path.expanduser("~/.cache/kira-helper-build/release/kira-helper")
mode = sys.argv[1]  # file | stream
vp = sys.argv[2] == "1" if len(sys.argv) > 2 else False
wav = sys.argv[3] if len(sys.argv) > 3 else ""
p = subprocess.Popen([helper], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
out = []
def reader():
    for line in p.stdout:
        out.append(line.rstrip())
def errs():
    for line in p.stderr:
        out.append("STDERR " + line.rstrip())
threading.Thread(target=reader, daemon=True).start()
threading.Thread(target=errs, daemon=True).start()
def send(obj):
    p.stdin.write(json.dumps(obj) + "\n"); p.stdin.flush()
if mode == "file":
    send({"id": "f", "cmd": "stt.file", "params": {"path": wav, "locale": "de-DE", "contextualStrings": ["KIRA", "Lucas", "Musterfirma"]}})
    time.sleep(12)
else:
    send({"id": "s", "cmd": "stt.start", "params": {"stream": "t", "locale": "de-DE", "contextualStrings": ["KIRA", "Lucas"], "source": "microphone", "voiceProcessing": vp}})
    time.sleep(1.5)
    subprocess.run(["say", "-v", "Anna", "Hallo KIRA, bitte frag Lucas nach dem Termin am Donnerstag um neun Uhr."])
    time.sleep(2.5)
    send({"id": "x", "cmd": "stt.stop", "params": {"stream": "t"}})
    time.sleep(3)
send({"id": "q", "cmd": "shutdown"})
time.sleep(0.5)
p.kill()
levels = [l for l in out if '"stt.level"' in l]
others = [l for l in out if '"stt.level"' not in l]
print(f"level events: {len(levels)}")
for l in others[:40]:
    print(l[:300])
