async function hasWebGPU() {
  if (!(navigator as any).gpu) {
    return false
  }
  try {
    const adapter = await (navigator as any).gpu.requestAdapter()
    return !!adapter
  } catch (e) {
    return false
  }
}
