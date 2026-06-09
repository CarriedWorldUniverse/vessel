import SwiftUI
import UIKit

@main
struct VesselApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var store = VesselStore()

    var body: some Scene {
        WindowGroup {
            RoomView()
                .environmentObject(store)
                .task {
                    await store.bootstrap()
                }
                .onChange(of: scenePhase) { _, phase in
                    Task {
                        await store.handleScenePhase(phase)
                    }
                }
        }
    }
}
