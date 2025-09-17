import * as http from 'http';
import { ConanServerManager } from './conan_server_manager';
import { PackageInfo, Profile, Remote, AllRemotes } from './conan_store';

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

    async getPackages(workspacePath: string, hostProfile: string, buildProfile: string, remoteName?: string): Promise<PackageInfo[]> {
        let url = `/packages?workspace_path=${encodeURIComponent(workspacePath)}&host_profile=${encodeURIComponent(hostProfile)}&build_profile=${encodeURIComponent(buildProfile)}`;

        if (remoteName) {
            url += `&remote=${encodeURIComponent(remoteName)}`;
        }

        return this.makeRequest(url);
    }

    async getProfiles(localProfilesPath?: string): Promise<Profile[]> {
        let url = '/profiles';
        if (localProfilesPath) {
            url += `?local_profiles_path=${encodeURIComponent(localProfilesPath)}`;
        }
        return this.makeRequest(url);
    }

    async getRemotes(): Promise<Remote[]> {
        return this.makeRequest('/remotes');
    }

    async getSettings(): Promise<any> {
        return this.makeRequest('/settings');
    }

    async installPackages(workspacePath: string, buildMissing: boolean = true, hostProfile: string, buildProfile: string): Promise<any> {
        return this.makeRequest('/install', 'POST', {
            workspace_path: workspacePath,
            build_missing: buildMissing,
            host_profile: hostProfile,
            build_profile: buildProfile
        });
    }

    async installPackage(packageRef: string, buildMissing: boolean = true, hostProfile: string, buildProfile: string, force: boolean = false): Promise<any> {
        return this.makeRequest('/install/package', 'POST', {
            package_ref: packageRef,
            build_missing: buildMissing,
            host_profile: hostProfile,
            build_profile: buildProfile,
            force: force
        });
    }

    async createProfile(name: string, settings?: { [key: string]: string | null }, localProfilesPath?: string): Promise<any> {
        return this.makeRequest('/profiles/create', 'POST', {
            name: name,
            detect: !settings, // Only auto-detect if no settings provided
            settings: settings || {},
            profiles_path: localProfilesPath
        });
    }

    async addRemote(name: string, url: string): Promise<any> {
        return this.makeRequest('/remotes/add', 'POST', {
            name: name,
            url: url,
            verify_ssl: true
        });
    }

    async uploadMissingPackages(workspacePath: string, remoteName: string, hostProfile: string, buildProfile: string, packages: string[] = [], force: boolean = false): Promise<any> {
        return this.makeRequest('/upload/missing', 'POST', {
            workspace_path: workspacePath,
            remote_name: remoteName,
            packages: packages,
            host_profile: hostProfile,
            build_profile: buildProfile,
            force: force
        });
    }

    async uploadLocalPackage(packageRef: string, remoteName: string, hostProfile: string, force: boolean = false): Promise<any> {
        return this.makeRequest('/upload/local', 'POST', {
            package_ref: packageRef,
            remote_name: remoteName,
            host_profile: hostProfile,
            force: force
        });
    }

    async getUploadStatus(): Promise<any> {
        return this.makeRequest('/upload/status');
    }
}
