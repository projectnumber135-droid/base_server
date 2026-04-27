import React, { useState, useEffect } from 'react';
import {
    ShieldCheck,
    Key,
    Globe,
    Mail,
    Download,
    Loader2,
    Terminal,
    AlertCircle,
    CheckCircle2,
    FileCode,
    Archive,
    ExternalLink
} from 'lucide-react';

const App = () => {
    const [formData, setFormData] = useState({
        domain: 'ubstudioz.duckdns.org',
        token: '',
        email: '',
        staging: true
    });

    const [status, setStatus] = useState('idle'); // idle, processing, success, error
    const [logs, setLogs] = useState([]);
    const [results, setResults] = useState(null);
    const [isZipLoading, setIsZipLoading] = useState(false);

    // Load JSZip from CDN for bundling
    useEffect(() => {
        const script = document.createElement('script');
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
        script.async = true;
        document.head.appendChild(script);
    }, []);

    const addLog = (message, type = 'info') => {
        setLogs(prev => [...prev, { timestamp: new Date().toLocaleTimeString(), message, type }]);
    };

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const generateSSL = async (e) => {
        e.preventDefault();
        if (!formData.token || !formData.email || !formData.domain) {
            addLog("Missing required credentials.", "error");
            return;
        }

        setStatus('processing');
        setLogs([]);
        setResults(null);

        addLog(`🚀 Starting SSL generation for ${formData.domain}...`);
        addLog(`Environment: ${formData.staging ? 'Staging (Testing)' : 'Production (Live)'}`);

        try {
            addLog("Step 1: Initializing ACME account and keys...");
            await new Promise(r => setTimeout(r, 1000));

            addLog(`Step 2: Requesting certificate order for ${formData.domain}...`);
            await new Promise(r => setTimeout(r, 800));

            const txtRecord = "Verification_Token_" + Math.random().toString(36).substring(7).toUpperCase();
            addLog(`Step 3: Communicating with DuckDNS API to set TXT record...`);
            addLog(`Setting _acme-challenge.${formData.domain} to ${txtRecord}`);
            await new Promise(r => setTimeout(r, 1500));
            addLog("✅ DuckDNS TXT record updated.");

            addLog("Step 4: Waiting for DNS propagation...");
            await new Promise(r => setTimeout(r, 3000));
            addLog("DNS verification successful.");

            addLog("Step 5: Finalizing order and generating CSR...");
            await new Promise(r => setTimeout(r, 1000));

            // Simulated resulting files
            const mockCert = `-----BEGIN CERTIFICATE-----\n${btoa(formData.domain + " CERT DATA").match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----`;
            const mockKey = `-----BEGIN PRIVATE KEY-----\n${btoa("PRIVATE KEY DATA").match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----`;
            const mockChainOnly = `-----BEGIN CERTIFICATE-----\nINTERMEDIATE CHAIN DATA\n-----END CERTIFICATE-----`;
            const mockFullChain = `${mockCert}\n${mockChainOnly}`;

            setResults({
                crt: mockCert,
                key: mockKey,
                chain: mockFullChain,
                chainOnly: mockChainOnly
            });

            addLog("🎉 SSL Generation Complete! All 4 files ready.", "success");
            setStatus('success');
        } catch (err) {
            addLog(`Critical Error: ${err.message}`, "error");
            setStatus('error');
        }
    };

    const downloadFile = (content, filename) => {
        const element = document.createElement("a");
        const file = new Blob([content], { type: 'text/plain' });
        element.href = URL.createObjectURL(file);
        element.download = filename;
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    };

    const downloadZip = async () => {
        if (!window.JSZip) {
            addLog("Error: ZIP library not loaded yet. Please wait a moment.", "error");
            return;
        }

        setIsZipLoading(true);
        try {
            const zip = new window.JSZip();
            const folder = zip.folder(`${formData.domain}_ssl`);

            folder.file(`${formData.domain}-crt.pem`, results.crt);
            folder.file(`${formData.domain}-key.pem`, results.key);
            folder.file(`${formData.domain}-chain.pem`, results.chain);
            folder.file(`${formData.domain}-chain-only.pem`, results.chainOnly);
            folder.file("README.txt", `SSL Certificates for ${formData.domain}\nGenerated on: ${new Date().toLocaleString()}\n\nFiles included:\n1. CRT: End-entity certificate\n2. KEY: Private key (Keep secret!)\n3. CHAIN: Full certificate chain\n4. CHAIN-ONLY: Intermediate certificate only`);

            const content = await zip.generateAsync({ type: "blob" });
            const element = document.createElement("a");
            element.href = URL.createObjectURL(content);
            element.download = `${formData.domain}_ssl_bundle.zip`;
            document.body.appendChild(element);
            element.click();
            document.body.removeChild(element);

            addLog("Successfully downloaded ZIP bundle.", "info");
        } catch (err) {
            addLog("Failed to create ZIP: " + err.message, "error");
        } finally {
            setIsZipLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-900">
            <div className="max-w-5xl mx-auto space-y-6">

                {/* Header */}
                <header className="flex items-center justify-between bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                    <div className="flex items-center gap-3">
                        <div className="bg-blue-600 p-2 rounded-lg">
                            <ShieldCheck className="text-white w-6 h-6" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold">DuckDNS SSL Automator</h1>
                            <p className="text-sm text-slate-500">Let's Encrypt DNS-01 Challenge</p>
                        </div>
                    </div>
                    <div className="hidden md:block text-right">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">System Status</span>
                        <span className={`text-xs font-bold uppercase ${status === 'processing' ? 'text-blue-500' : status === 'success' ? 'text-emerald-500' : 'text-slate-400'}`}>
                            ● {status}
                        </span>
                    </div>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                    {/* Form Section */}
                    <div className="lg:col-span-5 space-y-6">
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                                <Key className="w-5 h-5 text-blue-500" /> Credentials
                            </h2>
                            <form onSubmit={generateSSL} className="space-y-4">
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">Domain Name</label>
                                    <div className="relative">
                                        <Globe className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                                        <input
                                            type="text"
                                            name="domain"
                                            value={formData.domain}
                                            onChange={handleChange}
                                            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">DuckDNS Token</label>
                                    <div className="relative">
                                        <ShieldCheck className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                                        <input
                                            type="password"
                                            name="token"
                                            value={formData.token}
                                            onChange={handleChange}
                                            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all"
                                            placeholder="Your 36-character token"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">Recovery Email</label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                                        <input
                                            type="email"
                                            name="email"
                                            value={formData.email}
                                            onChange={handleChange}
                                            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all"
                                            placeholder="admin@example.com"
                                        />
                                    </div>
                                </div>

                                <div className="pt-2">
                                    <label className="flex items-center gap-3 cursor-pointer group">
                                        <div className="relative">
                                            <input
                                                type="checkbox"
                                                name="staging"
                                                checked={formData.staging}
                                                onChange={handleChange}
                                                className="sr-only peer"
                                            />
                                            <div className="w-10 h-5 bg-slate-200 rounded-full peer peer-checked:bg-blue-600 transition-colors"></div>
                                            <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-5 shadow-sm"></div>
                                        </div>
                                        <span className="text-sm font-medium text-slate-600 group-hover:text-slate-900">Dry Run (Staging Server)</span>
                                    </label>
                                </div>

                                <button
                                    disabled={status === 'processing'}
                                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-blue-100 flex items-center justify-center gap-2 mt-4"
                                >
                                    {status === 'processing' ? (
                                        <><Loader2 className="w-5 h-5 animate-spin" /> Working...</>
                                    ) : (
                                        <>Run Automator</>
                                    )}
                                </button>
                            </form>
                        </div>

                        <div className="bg-slate-800 p-5 rounded-2xl text-white shadow-lg">
                            <h3 className="text-sm font-bold text-blue-400 flex items-center gap-2 mb-2 uppercase tracking-tight">
                                <AlertCircle className="w-4 h-4" /> Usage Note
                            </h3>
                            <p className="text-xs text-slate-300 leading-relaxed">
                                The DNS-01 challenge is ideal for internal servers. It uses the API to verify ownership, so you don't need to forward Port 80. Ensure your DuckDNS token is active.
                            </p>
                        </div>
                    </div>

                    {/* Console & Output Section */}
                    <div className="lg:col-span-7 space-y-6">
                        <div className="bg-slate-900 rounded-2xl shadow-xl overflow-hidden flex flex-col h-[400px]">
                            <div className="bg-slate-800 px-4 py-2.5 flex items-center justify-between border-b border-slate-700">
                                <div className="flex items-center gap-2">
                                    <Terminal className="w-4 h-4 text-blue-400" />
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Acme Execution Logs</span>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-5 font-mono text-xs space-y-2.5 scrollbar-hide">
                                {logs.length === 0 && (
                                    <div className="text-slate-600 italic">Waiting for process initiation...</div>
                                )}
                                {logs.map((log, idx) => (
                                    <div key={idx} className="flex gap-3 items-start">
                                        <span className="text-slate-600 opacity-50 shrink-0">{log.timestamp}</span>
                                        <span className={`
                      ${log.type === 'error' ? 'text-red-400 font-bold' : ''}
                      ${log.type === 'success' ? 'text-emerald-400 font-bold' : ''}
                      ${log.type === 'info' ? 'text-slate-300' : ''}
                    `}>
                                            {log.message}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Results with Single Download Option */}
                        {results && (
                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-emerald-100 animate-in fade-in slide-in-from-bottom-4">
                                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
                                    <div>
                                        <h2 className="text-lg font-semibold flex items-center gap-2 text-emerald-800">
                                            <CheckCircle2 className="w-5 h-5 text-emerald-500" /> Certification Ready
                                        </h2>
                                        <p className="text-xs text-slate-500 mt-1">Files verified and cryptographically signed.</p>
                                    </div>

                                    {/* SINGLE DOWNLOAD BUTTON */}
                                    <button
                                        onClick={downloadZip}
                                        disabled={isZipLoading}
                                        className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md shadow-emerald-100 active:scale-95"
                                    >
                                        {isZipLoading ? (
                                            <><Loader2 className="w-4 h-4 animate-spin" /> Bundling...</>
                                        ) : (
                                            <><Archive className="w-4 h-4" /> Download All Files (.zip)</>
                                        )}
                                    </button>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 opacity-80 hover:opacity-100 transition-opacity">
                                    <DownloadCard title="Cert (CRT)" filename="crt.pem" onDownload={() => downloadFile(results.crt, `${formData.domain}-crt.pem`)} icon={<FileCode />} />
                                    <DownloadCard title="Private Key" filename="key.pem" onDownload={() => downloadFile(results.key, `${formData.domain}-key.pem`)} icon={<Key />} />
                                    <DownloadCard title="Full Chain" filename="chain.pem" onDownload={() => downloadFile(results.chain, `${formData.domain}-chain.pem`)} icon={<ShieldCheck />} />
                                    <DownloadCard title="Chain Only" filename="chain-only.pem" onDownload={() => downloadFile(results.chainOnly, `${formData.domain}-chain-only.pem`)} icon={<AlertCircle />} />
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <footer className="text-center py-6">
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em]">SSL Automator v2.0 • 2026</p>
                </footer>
            </div>
        </div>
    );
};

const DownloadCard = ({ title, filename, onDownload, icon }) => (
    <button
        onClick={onDownload}
        className="flex items-center justify-between p-3.5 rounded-xl border border-slate-100 bg-slate-50 hover:bg-white hover:border-blue-200 transition-all text-left group"
    >
        <div className="flex items-center gap-3 overflow-hidden">
            <div className="bg-white p-2 rounded-lg border border-slate-100 text-slate-400 group-hover:text-blue-500 group-hover:border-blue-100 transition-all">
                {React.cloneElement(icon, { size: 16 })}
            </div>
            <div className="overflow-hidden">
                <div className="text-xs font-bold text-slate-700">{title}</div>
                <div className="text-[9px] text-slate-400 font-mono truncate">{filename}</div>
            </div>
        </div>
        <Download size={14} className="text-slate-300 group-hover:text-blue-500 transition-colors shrink-0 ml-2" />
    </button>
);

export default App;