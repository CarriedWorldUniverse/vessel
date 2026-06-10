import Foundation

struct ResolvedTarget {
    let cleanText: String
    let targetAspectId: String?
}

final class TargetResolver {
    private let knownCorrections: [String: String] = [
        "plum": "plumb",
        "plumber": "plumb",
        "next us": "nexus",
        "bridal": "bridle"
    ]

    func resolve(_ text: String, roster: [Aspect], currentTarget: String?) -> ResolvedTarget {
        var cleaned = normalize(text)
        let lowered = cleaned.lowercased()

        guard lowered.hasPrefix("hey ") else {
            return ResolvedTarget(cleanText: cleaned, targetAspectId: currentTarget)
        }

        let afterHey = String(cleaned.dropFirst(4))
        let parts = afterHey.split(maxSplits: 1, whereSeparator: { $0 == " " || $0 == "," || $0 == "." })
        guard let rawName = parts.first else {
            return ResolvedTarget(cleanText: cleaned, targetAspectId: currentTarget)
        }

        let name = corrected(String(rawName).lowercased())
        guard let aspect = roster.first(where: { aspect in
            aspect.id.lowercased() == name || aspect.name.lowercased() == name
        }) else {
            return ResolvedTarget(cleanText: cleaned, targetAspectId: currentTarget)
        }

        if parts.count > 1 {
            cleaned = String(parts[1]).trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
        } else {
            cleaned = ""
        }

        return ResolvedTarget(cleanText: cleaned, targetAspectId: aspect.id)
    }

    private func normalize(_ text: String) -> String {
        var result = text.trimmingCharacters(in: .whitespacesAndNewlines)
        for (bad, good) in knownCorrections {
            result = result.replacingOccurrences(of: bad, with: good, options: [.caseInsensitive])
        }
        return result
    }

    private func corrected(_ token: String) -> String {
        knownCorrections[token] ?? token
    }
}
