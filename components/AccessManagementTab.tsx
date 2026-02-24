import React, { useState, useEffect } from 'react';
import { db } from '../services/db';
import { Shield, UserPlus, Trash2, Mail } from 'lucide-react';
import { UsageDashboard } from './UsageDashboard';

interface AccessManagementTabProps {
    usageData: {
        counts: {
            tenants: number;
            properties: number;
            bills: number;
            waterBills: number;
        };
    };
}

const AccessManagementTab: React.FC<AccessManagementTabProps> = ({ usageData }) => {
    const [emails, setEmails] = useState<string[]>([]);
    const [newEmail, setNewEmail] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        return db.subscribeToAllowedEmails((data) => {
            setEmails(data);
            setLoading(false);
        });
    }, []);

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newEmail || !newEmail.includes('@')) return;

        try {
            await db.addAllowedEmail(newEmail.toLowerCase());
            setNewEmail('');
        } catch (error) {
            console.error(error);
            alert("Erro ao adicionar e-mail.");
        }
    };

    const handleDelete = async (email: string) => {
        if (email === 'rogerioboitto@gmail.com') {
            alert("O e-mail principal não pode ser removido.");
            return;
        }

        if (window.confirm(`Remover acesso de ${email}?`)) {
            try {
                await db.deleteAllowedEmail(email);
            } catch (error) {
                console.error(error);
            }
        }
    };

    return (
        <div className="space-y-6">
            <div className="bg-neutral-900 rounded-3xl p-8 border border-neutral-800">
                <div className="flex items-center space-x-4 mb-8">
                    <div className="w-12 h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center border border-emerald-500/20">
                        <Shield className="w-6 h-6 text-emerald-400" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-white">Controle de Acesso</h2>
                        <p className="text-neutral-400">Gerencie quem pode acessar o sistema</p>
                    </div>
                </div>

                <form onSubmit={handleAdd} className="flex space-x-4 mb-8">
                    <div className="relative flex-1">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-500" />
                        <input
                            type="email"
                            value={newEmail}
                            onChange={(e) => setNewEmail(e.target.value)}
                            placeholder="Digite o e-mail do Gmail"
                            className="w-full h-12 bg-neutral-950 border border-neutral-800 rounded-2xl pl-12 pr-4 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all shadow-inner"
                        />
                    </div>
                    <button
                        type="submit"
                        className="px-6 h-12 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded-2xl transition-all flex items-center space-x-2 shadow-lg shadow-emerald-500/20 active:scale-95"
                    >
                        <UserPlus className="w-5 h-5" />
                        <span>Adicionar</span>
                    </button>
                </form>

                <div className="space-y-3">
                    {loading ? (
                        <div className="text-center py-8 text-neutral-500">Carregando permissões...</div>
                    ) : (
                        emails.map((email) => (
                            <div
                                key={email}
                                className="flex items-center justify-between p-4 bg-neutral-950 rounded-2xl border border-neutral-800 hover:border-neutral-700 transition-all group"
                            >
                                <div className="flex items-center space-x-3">
                                    <div className="w-8 h-8 bg-neutral-900 rounded-lg flex items-center justify-center border border-neutral-800 text-neutral-400 font-mono text-[10px]">
                                        G
                                    </div>
                                    <span className="text-white font-medium">{email}</span>
                                </div>
                                <button
                                    onClick={() => handleDelete(email)}
                                    disabled={email === 'rogerioboitto@gmail.com'}
                                    className={`p-2 rounded-xl transition-all ${email === 'rogerioboitto@gmail.com'
                                        ? 'text-neutral-700 cursor-not-allowed opacity-50'
                                        : 'text-neutral-500 hover:bg-red-500/10 hover:text-red-400'
                                        }`}
                                >
                                    <Trash2 className="w-5 h-5" />
                                </button>
                            </div>
                        ))
                    )}
                </div>

                {/* Dashboard de Uso Automático */}
                <UsageDashboard counts={usageData.counts} />
            </div>
        </div>
    );
};

export default AccessManagementTab;
