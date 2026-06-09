import Foundation

struct ResponseItem: Identifiable, Equatable {
    let id: String
    let aspectId: String
    var title: String
    var speech: String
    var detail: String
    var receivedAt: Date
    var spoken: Bool
}
