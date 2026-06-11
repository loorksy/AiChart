#!/usr/bin/env python3
import sys
p = sys.argv[1]
data = open(p, "rb").read().replace(b"\r\n", b"\n").replace(b"\r", b"")
open(p, "wb").write(data)
print("fixed", p)
