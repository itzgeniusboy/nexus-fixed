import { planAndroidArtifactTest } from "./android-audit"

describe("Android artifact testing plan", () => {
  test("plans APK device checks only when a device is connected", () => {
    const plan = planAndroidArtifactTest({
      artifact: "build/outputs/apk/debug/app-debug.apk",
      capabilities: { android: true, androidDevice: true, apkBuild: true },
    })
    expect(plan.artifactType).toBe("apk")
    expect(plan.canRunDeviceChecks).toBe(true)
    expect(plan.approvalRequired.some((item) => /install/i.test(item))).toBe(true)
  })

  test("keeps APK device checks checkpointed without a device", () => {
    const plan = planAndroidArtifactTest({
      artifact: "app.apk",
      capabilities: { android: true, androidDevice: false, apkBuild: true },
    })
    expect(plan.canRunDeviceChecks).toBe(false)
    expect(plan.limitations.some((item) => /connected/i.test(item))).toBe(true)
  })

  test("does not pretend an AAB is directly installable", () => {
    const plan = planAndroidArtifactTest({
      artifact: "app-release.aab",
      capabilities: { android: true, androidDevice: true, apkBuild: true },
    })
    expect(plan.artifactType).toBe("aab")
    expect(plan.canRunDeviceChecks).toBe(false)
    expect(plan.limitations).toContain("An AAB is not directly installable with adb.")
  })

  test("rejects non-Android artifacts", () => {
    expect(() =>
      planAndroidArtifactTest({
        artifact: "dist/site.zip",
        capabilities: { android: false, androidDevice: false, apkBuild: false },
      }),
    ).toThrow(/\.apk or \.aab/i)
  })
})
