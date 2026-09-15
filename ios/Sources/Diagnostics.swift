import Foundation
import os

/// Appends timestamped progress lines, with available memory, to a file in the
/// app's Documents directory.
///
/// A SIGKILL leaves no crash report and drops buffered stdout, so `NSLog` alone
/// cannot show how far startup got. Each line is flushed immediately, and the
/// file can be pulled off the device with:
///
///     xcrun devicectl device copy from --device <id> \
///       --domain-type appDataContainer \
///       --domain-identifier com.kaifengwu.parallaxwindow \
///       --source Documents/diag.log --destination /tmp/diag.log
enum Diagnostics {
    private static let lock = NSLock()

    private static let fileURL: URL? = {
        guard let directory = FileManager.default.urls(
            for: .documentDirectory, in: .userDomainMask).first
        else { return nil }
        return directory.appendingPathComponent("diag.log")
    }()

    /// Truncates the log so each run starts clean.
    static func startRun() {
        guard let fileURL else { return }
        try? Data().write(to: fileURL)
        log("=== run started ===")
    }

    static func log(_ message: String) {
        let availableMB = Double(os_proc_available_memory()) / 1_000_000
        let line = String(
            format: "%9.3f  avail=%5.0fMB  %@\n",
            ProcessInfo.processInfo.systemUptime, availableMB, message)

        NSLog("DIAG %@", message)

        guard let fileURL else { return }
        lock.lock()
        defer { lock.unlock() }

        if let handle = try? FileHandle(forWritingTo: fileURL) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: Data(line.utf8))
        } else {
            try? Data(line.utf8).write(to: fileURL)
        }
    }
}
