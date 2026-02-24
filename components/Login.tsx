import React from 'react';
import { authInstance, googleProvider } from '../services/firebaseConfig';
import { signInWithPopup } from 'firebase/auth';
import { LogIn } from 'lucide-react';

const Login: React.FC = () => {
    const handleLogin = async () => {
        try {
            await signInWithPopup(authInstance, googleProvider);
        } catch (error: any) {
            console.error("Erro ao fazer login:", error);
            alert(`Erro ao realizar login: ${error.message || 'Erro desconhecido'}\n\nVerifique se o domínio boitto.web.app está autorizado no Firebase Console.`);
        }
    };

    return (
        <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-neutral-900 rounded-3xl p-8 border border-neutral-800 shadow-2xl text-center">
                <div className="w-20 h-20 bg-emerald-500/10 rounded-2xl flex items-center justify-center mx-auto mb-8 border border-emerald-500/20">
                    <LogIn className="w-10 h-10 text-emerald-400" />
                </div>

                <h1 className="text-3xl font-bold text-white mb-2">BOITTO</h1>
                <p className="text-neutral-400 mb-8">Gestão inteligente de aluguéis e faturas</p>

                <button
                    onClick={handleLogin}
                    className="w-full h-14 bg-white hover:bg-neutral-100 text-black font-semibold rounded-2xl transition-all duration-300 flex items-center justify-center space-x-3 shadow-lg hover:translate-y-[-2px] active:translate-y-0"
                >
                    <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
                    <span>Entrar com Google</span>
                </button>

                <p className="mt-8 text-xs text-neutral-500">
                    Acesso restrito a usuários autorizados
                </p>
            </div>
        </div>
    );
};

export default Login;
