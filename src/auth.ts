import { ipcMain, BrowserWindow } from 'electron';
import { Auth } from 'msmc';

export function registerAuthIPC() {
  ipcMain.handle('auth:microsoft', async () => {
    try {
      // Use msmc to authenticate with Microsoft
      const authManager = new Auth("select_account");
      const xboxManager = await authManager.launch("electron");
      const token = await xboxManager.getMinecraft();
      
      if (!token.profile) throw new Error("No Minecraft profile found");
      return {
        success: true,
        profile: {
          id: token.profile.id,
          name: token.profile.name,
          type: 'microsoft',
          token: token.mclc() // formatted for minecraft-launcher-core
        }
      };
    } catch (error: any) {
      console.error("Microsoft Auth Error:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('auth:elyby', async (_event, username, password) => {
    try {
      // Ely.by Yggdrasil Auth
      const fetch = (await import('node-fetch')).default;
      const res = await fetch('https://authserver.ely.by/auth/authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: { name: 'Minecraft', version: 1 },
          username,
          password,
          clientToken: require('crypto').randomUUID()
        })
      });
      const data = await res.json() as any;
      if (data.error) throw new Error(data.errorMessage);

      return {
        success: true,
        profile: {
          id: data.selectedProfile.id,
          name: data.selectedProfile.name,
          type: 'elyby',
          token: {
            access_token: data.accessToken,
            client_token: data.clientToken,
            uuid: data.selectedProfile.id,
            name: data.selectedProfile.name,
            user_properties: '{}',
            meta: {
              type: 'mojang',
              demo: false
            }
          }
        }
      };
    } catch (error: any) {
      console.error("Ely.by Auth Error:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('auth:offline', async (_event, username) => {
    return {
      success: true,
      profile: {
        id: require('crypto').randomUUID().replace(/-/g, ''),
        name: username,
        type: 'offline',
        token: null
      }
    };
  });
}
