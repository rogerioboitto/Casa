import React, { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

interface InstallPromptProps {
    isOpen?: boolean;
    onClose?: () => void;
}

export const InstallPrompt: React.FC<InstallPromptProps> = ({ isOpen, onClose }) => {
    const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [isIOS, setIsIOS] = useState(false);
    const [showManualInstructions, setShowManualInstructions] = useState(false);
    const [isInstalling, setIsInstalling] = useState(false);

    // Synchronize visibility with isOpen prop
    useEffect(() => {
        if (isOpen !== undefined) {
            setIsVisible(isOpen);
        }
    }, [isOpen]);

    useEffect(() => {
        // Check if device is iOS
        const isIosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
        setIsIOS(isIosDevice);

        // Check if already in standalone mode
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;

        if (isStandalone) return;

        // Android/Desktop PWA prompt
        const handler = (e: any) => {
            e.preventDefault();
            setDeferredPrompt(e);
            // Only show automatically if not explicitly controlled by props
            if (isOpen === undefined) {
                setIsVisible(true);
            }
        };

        window.addEventListener('beforeinstallprompt', handler);

        // iOS prompt logic (show after a few seconds if not installed and not controlled)
        if (isIosDevice && isOpen === undefined) {
            const timer = setTimeout(() => {
                setIsVisible(true);
            }, 3000);
            return () => clearTimeout(timer);
        }

        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, [isOpen]);

    const handleClose = () => {
        setIsVisible(false);
        if (onClose) onClose();
    };

    const handleInstallClick = async () => {
        console.log('Attempting to install...', { hasPrompt: !!deferredPrompt });
        setIsInstalling(true);

        if (deferredPrompt) {
            try {
                // Safety timeout: if browser doesn't show anything in 5s, fallback to manual
                const timeoutId = setTimeout(() => {
                    if (isInstalling) {
                        setIsInstalling(false);
                        setShowManualInstructions(true);
                    }
                }, 5000);

                // Trigger the prompt
                await deferredPrompt.prompt();

                // Wait for the user to respond to the prompt
                const { outcome } = await deferredPrompt.userChoice;
                clearTimeout(timeoutId);
                console.log(`User response to install prompt: ${outcome}`);

                if (outcome === 'accepted') {
                    setDeferredPrompt(null);
                    handleClose();
                } else {
                    setShowManualInstructions(true);
                }
            } catch (err) {
                console.error("Error during installation prompt:", err);
                setIsInstalling(false);
                setShowManualInstructions(true); // Also show manual instructions on error
            } finally {
                setIsInstalling(false);
            }
        } else {
            setShowManualInstructions(true);
        }
    };

    if (!isVisible) return null;

    return (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-slate-900 text-white p-4 rounded-2xl shadow-2xl z-[100] animate-fade-in border border-slate-700">
            <button
                onClick={handleClose}
                className="absolute top-2 right-2 text-slate-400 hover:text-white p-1"
            >
                <X size={16} />
            </button>

            <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center shrink-0">
                    <Download className="text-white" size={24} />
                </div>
                <div>
                    <h3 className="font-bold text-lg leading-tight mb-1">Instalar Aplicativo</h3>
                    <p className="text-slate-300 text-sm mb-3">
                        {isIOS
                            ? "Instale o app para acesso rápido e melhor experiência."
                            : "Adicione à tela inicial para usar como aplicativo nativo."}
                    </p>

                    {isIOS || showManualInstructions ? (
                        <div className="text-xs text-slate-400 bg-slate-800 p-3 rounded-lg border border-slate-700">
                            {isIOS ? (
                                <>Toque em <span className="font-bold text-blue-400">Compartilhar</span> e depois em <span className="font-bold text-white">Adicionar à Tela de Início</span>.</>
                            ) : (
                                <>Abra o menu do navegador (três pontos <span className="font-bold text-white">⋮</span>) e selecione <span className="font-bold text-emerald-400">Instalar</span> ou <span className="font-bold text-emerald-400">Adicionar à tela de início</span>.</>
                            )}
                        </div>
                    ) : (
                        <button
                            onClick={handleInstallClick}
                            disabled={isInstalling}
                            className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2.5 rounded-xl font-bold text-sm transition-all w-full shadow-lg shadow-emerald-500/20 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {isInstalling && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                            {isInstalling ? "Processando..." : (deferredPrompt ? "Instalar Agora" : "Como Instalar")}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
