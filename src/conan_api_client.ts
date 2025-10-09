import * as http from 'http';
import { ConanServerManager } from './conan_server_manager';
import { PackageInfo, Profile, Remote } from './conan_store';

interface AddRemoteResponse {
    success: boolean;
    requires_auth: boolean;
}

// HTTP client for server communication
export class ConanApiClient {
    constructor(private serverManager: ConanServerManager) { }

    async makeRequest(endpoint: string, method: string = 'GET', data?: any): Promise<any> {
        return new Promise((resolve, reject) => {
            const backendUrl = this.serverManager.backendUrl;
            if (!backendUrl) {
                reject(new Error('Backend URL not available'));
                return;
            }

            const url = new URL(endpoint, backendUrl);
            const options = {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname + url.search,
                method: method,
                headers: {
                    'Content-Type': 'application/json'
                }
            };

            const req = http.request(options, (res) => {
                let responseData = '';

                res.on('data', (chunk) => {
                    responseData += chunk;
                });

                res.on('end', () => {
                    try {
                        const jsonData = JSON.parse(responseData);
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(jsonData);
                        } else {
                            reject(new Error(jsonData.detail || 'Server error'));
                        }
                    } catch (error) {
                        reject(new Error('Invalid JSON response'));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            if (data) {
                req.write(JSON.stringify(data));
            }

            req.end();
        });
    }

    async getSettings(): Promise<any> {
        return this.makeRequest('/settings');
    }

    async getConanHome(): Promise<string> {
        return this.makeRequest('/config/home');
    }

    async getPackages(workspacePath: string, hostProfile: string, buildProfile: string, remoteName?: string): Promise<PackageInfo[]> {
        let url = `/packages?workspace_path=${encodeURIComponent(workspacePath)}&host_profile=${encodeURIComponent(hostProfile)}&build_profile=${encodeURIComponent(buildProfile)}`;

        if (remoteName) {
            url += `&remote=${encodeURIComponent(remoteName)}`;
        }

        return this.makeRequest(url);
    }

    async installPackages(workspacePath: string, buildMissing: boolean = true, hostProfile: string, buildProfile: string): Promise<any> {
        return this.makeRequest('/packages/install', 'POST', {
            workspace_path: workspacePath,
            build_missing: buildMissing,
            host_profile: hostProfile,
            build_profile: buildProfile
        });
    }

    async installPackage(workspacePath: string, packageRef: string, buildMissing: boolean = true, hostProfile: string, buildProfile: string, force: boolean = false): Promise<any> {
        return this.makeRequest('/packages/install/package', 'POST', {
            workspace_path: workspacePath,
            package_ref: packageRef,
            build_missing: buildMissing,
            host_profile: hostProfile,
            build_profile: buildProfile,
            force: force
        });
    }

    async uploadLocalPackage(workspacePath: string, packageRef: string, packageId: string, remoteName: string, hostProfile: string, force: boolean = false): Promise<any> {
        return this.makeRequest('/packages/upload/local', 'POST', {
            workspace_path: workspacePath,
            package_ref: packageRef,
            package_id: packageId,
            remote_name: remoteName,
            host_profile: hostProfile,
            force: force
        });
    }

    async getProfiles(localProfilesPath?: string): Promise<Profile[]> {
        let url = '/profiles';
        if (localProfilesPath) {
            url += `?local_profiles_path=${encodeURIComponent(localProfilesPath)}`;
        }
        return this.makeRequest(url);
    }

    async createProfile(name: string, settings?: { [key: string]: string | null }, localProfilesPath?: string): Promise<any> {
        return this.makeRequest('/profiles/create', 'POST', {
            name: name,
            detect: !settings, // Only auto-detect if no settings provided
            settings: settings || {},
            profiles_path: localProfilesPath
        });
    }

    async getRemotes(): Promise<Remote[]> {
        return this.makeRequest('/remotes');
    }

    async addRemote(name: string, url: string): Promise<AddRemoteResponse> {
        return this.makeRequest('/remotes/add', 'POST', {
            name: name,
            url: url,
            verify_ssl: true
        });
    }

    async loginRemote(name: string, user: string, password: string): Promise<any> {
        return this.makeRequest('/remotes/login', 'POST', {
            name: name,
            user: user,
            password: password
        });
    }

    async removeRemote(name: string): Promise<any> {
        return this.makeRequest('/remotes/remove', 'POST', { name: name });
    }

    async buildPackage(workspacePath: string, hostProfile: string, buildProfile: string, options: any = {}): Promise<any> {
        return this.makeRequest('/project/build', 'POST', {
            workspace_path: workspacePath,
            host_profile: hostProfile,
            build_profile: buildProfile,
            options: options
        });
    }

    async createPackage(workspacePath: string, hostProfile: string, buildProfile: string, options: any = {}): Promise<any> {
        return this.makeRequest('/project/create', 'POST', {
            workspace_path: workspacePath,
            host_profile: hostProfile,
            build_profile: buildProfile,
            options: options
        });
    }

    async testPackage(workspacePath: string, hostProfile: string, buildProfile: string, options: any = {}): Promise<any> {
        return this.makeRequest('/project/test', 'POST', {
            workspace_path: workspacePath,
            host_profile: hostProfile,
            build_profile: buildProfile,
            options: options
        });
    }
}
