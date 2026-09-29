// Probe-only classification: every upload request remains denied.
export function isExpectedFakeUpload(toolName,input,fakeFile){
  return ['browser_file_upload','mcp__k_browser__browser_file_upload'].includes(toolName)
    && Array.isArray(input?.paths) && input.paths.length===1 && input.paths[0]===fakeFile;
}
