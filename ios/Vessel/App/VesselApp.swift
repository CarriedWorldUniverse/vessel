import SwiftUI

@main
struct VesselApp: App {
    @StateObject private var store = VesselStore()

    var body: some Scene {
        WindowGroup {
            RoomView()
                .environmentObject(store)
                .task {
                    await store.bootstrap()
                }
        }
    }
}
