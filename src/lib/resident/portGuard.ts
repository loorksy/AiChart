/**
 * Reclaiming the health port from a dead worker's orphan.
 *
 * The incident this exists for: pm2 launched the worker through `npm`, so
 * the pid pm2 reported was the SHELL. Killing it (a `kill -9`, an OOM kill,
 * a segfault) left the real `node … src/worker.ts` process alive and still
 * holding port 8791, and every restart then died on EADDRINUSE — the
 * restart counter climbed past a hundred with no converging state and no
 * visible cause. pm2 now execs the process directly, which fixes the cause;
 * this is the belt for the cases that still orphan a child.
 *
 * The rule is narrow on purpose: we only ever signal a process whose own
 * command line says it is THIS worker. A port guard that kills whatever
 * holds a port is a foot-gun — it would happily kill an unrelated service
 * that happened to bind first.
 */
import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import { createLogger } from "@/lib/logger";

const log = createLogger("resident.port");

/** Command-line fragments that identify a Lonora worker process. */
const WORKER_MARKERS = ["src/worker.ts", "dist/worker.js", "aichart-worker"];

function cmdlineOf(pid: string): string {
  try {
    // /proc cmdline is NUL-separated; spaces make it matchable.
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ").trim();
  } catch {
    return "";
  }
}

/** Which pids hold the socket with this inode (walks /proc/<pid>/fd). */
function pidsHoldingInode(inode: string): string[] {
  const holders: string[] = [];
  const target = `socket:[${inode}]`;
  let pids: string[];
  try {
    pids = readdirSync("/proc").filter((name) => /^\d+$/.test(name));
  } catch {
    return holders;
  }
  for (const pid of pids) {
    let fds: string[];
    try {
      fds = readdirSync(`/proc/${pid}/fd`);
    } catch {
      // A process that exited mid-walk, or one we may not inspect.
      continue;
    }
    for (const fd of fds) {
      try {
        if (readlinkSync(`/proc/${pid}/fd/${fd}`) === target) {
          holders.push(pid);
          break;
        }
      } catch {
        continue;
      }
    }
  }
  return holders;
}

/** The socket inodes currently LISTENing on `port` (IPv4 + IPv6). */
function listeningInodes(port: number): string[] {
  const hex = port.toString(16).toUpperCase().padStart(4, "0");
  const inodes: string[] = [];
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 10) continue;
      // local_address is host:port in hex; state 0A = LISTEN.
      if (!cols[1]?.endsWith(`:${hex}`)) continue;
      if (cols[3] !== "0A") continue;
      const inode = cols[9];
      if (inode && inode !== "0") inodes.push(inode);
    }
  }
  return inodes;
}

export interface PortReclaim {
  /** Pids we signalled (ours excluded, non-worker processes excluded). */
  killed: number[];
  /** Pids holding the port that we deliberately did NOT touch. */
  skipped: number[];
}

/**
 * Free `port` if — and only if — it is held by an orphaned copy of this
 * worker. Returns what was signalled so the caller can log it honestly.
 */
export function reclaimWorkerPort(port: number): PortReclaim {
  const result: PortReclaim = { killed: [], skipped: [] };
  for (const inode of listeningInodes(port)) {
    for (const pid of pidsHoldingInode(inode)) {
      const numeric = Number(pid);
      if (!Number.isFinite(numeric) || numeric === process.pid) continue;
      const cmd = cmdlineOf(pid);
      if (!WORKER_MARKERS.some((marker) => cmd.includes(marker))) {
        // Somebody else's port. Refusing to kill it is the whole point.
        result.skipped.push(numeric);
        log.warn("port held by a process that is not this worker", {
          port,
          pid: numeric,
          cmd: cmd.slice(0, 120),
        });
        continue;
      }
      try {
        process.kill(numeric, "SIGTERM");
        result.killed.push(numeric);
        log.warn("reclaimed the health port from an orphaned worker", {
          port,
          pid: numeric,
        });
      } catch (err) {
        log.warn("could not signal the orphaned worker", {
          port,
          pid: numeric,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return result;
}
