#!/usr/bin/env python3
import json
import subprocess

out = subprocess.check_output(
    [
        "sudo",
        "-u",
        "postgres",
        "psql",
        "-d",
        "aichart",
        "-t",
        "-A",
        "-c",
        "SELECT id, command_type, status, result_json FROM ea_commands ORDER BY id DESC LIMIT 5;",
    ],
    text=True,
)
for line in out.strip().splitlines():
    parts = line.split("|", 3)
    if len(parts) >= 4:
        print("id", parts[0], "type", parts[1], "status", parts[2])
        print("result", parts[3][:400])
        print("---")
