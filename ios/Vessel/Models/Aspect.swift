import Foundation

struct Aspect: Identifiable, Equatable, Codable {
    let id: String
    var name: String
    var colorHex: String?
    var isOnline: Bool
    var isMuted: Bool

    var displayName: String {
        name.isEmpty ? id : name
    }
}
