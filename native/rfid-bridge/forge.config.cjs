module.exports = {
  packagerConfig: {
    asar: true,
    name: 'Dallmayr RFID Bridge',
    executableName: 'DallmayrRFIDBridge'
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'DallmayrRFIDBridge',
        setupExe: 'Dallmayr-RFID-Setup.exe',
        noMsi: true
      }
    }
  ]
};
