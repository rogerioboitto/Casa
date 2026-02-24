import React, { useState, useRef } from 'react';
import { X, Upload, FileText, Trash2, ExternalLink, CheckCircle } from 'lucide-react';
import { Tenant, TenantDocument } from '../types';
import { db } from '../services/db';

interface TenantDocumentsModalProps {
    isOpen: boolean;
    onClose: () => void;
    tenant: Tenant;
    onUpdateTenant: (updatedTenant: Tenant) => void;
    showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

const DOCUMENT_TYPES = [
    "Contrato de Locação",
    "CNH / RG",
    "Comprovante de Renda",
    "Vistoria de Entrada (Vídeo)",
    "Vistoria de Entrada (Fotos)",
    "Vistoria de Saída (Vídeo)",
    "Vistoria de Saída (Fotos)",
    "Outros"
];

export const TenantDocumentsModal: React.FC<TenantDocumentsModalProps> = ({
    isOpen,
    onClose,
    tenant,
    onUpdateTenant,
    showToast
}) => {
    const [selectedType, setSelectedType] = useState(DOCUMENT_TYPES[0]);
    const [uploadProgress, setUploadProgress] = useState<number | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    if (!isOpen) return null;

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validação básica de tamanho (ex: 100MB para vídeos)
        if (file.size > 100 * 1024 * 1024) {
            showToast("Arquivo muito grande (máx 100MB).", 'error');
            return;
        }

        try {
            setUploadProgress(0);
            const newDoc = await db.uploadTenantDocument(tenant.id, file, selectedType, (progress) => {
                setUploadProgress(progress);
            });

            const updatedDocuments = [...(tenant.documents || []), newDoc];
            const updatedTenant = { ...tenant, documents: updatedDocuments };

            await db.updateTenant(tenant.id, { documents: updatedDocuments });
            onUpdateTenant(updatedTenant);

            showToast("Documento enviado com sucesso!", 'success');
            if (fileInputRef.current) fileInputRef.current.value = '';
        } catch (error) {
            console.error(error);
            showToast("Erro ao enviar documento.", 'error');
        } finally {
            setUploadProgress(null);
        }
    };

    const handleDelete = async (docId: string, url: string) => {
        if (!window.confirm("Deseja realmente excluir este documento?")) return;

        try {
            await db.deleteTenantDocument(url);

            const updatedDocuments = (tenant.documents || []).filter(d => d.id !== docId);
            const updatedTenant = { ...tenant, documents: updatedDocuments };

            await db.updateTenant(tenant.id, { documents: updatedDocuments });
            onUpdateTenant(updatedTenant);

            showToast("Documento excluído.", 'success');
        } catch (error) {
            console.error(error);
            showToast("Erro ao excluir documento.", 'error');
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="bg-slate-900 px-6 py-4 flex justify-between items-center shrink-0">
                    <div>
                        <h3 className="text-xl font-bold text-white">Documentos do Inquilino</h3>
                        <p className="text-slate-400 text-sm">{tenant.name}</p>
                    </div>
                    <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1 space-y-6">

                    {/* Upload Section */}
                    <div className="bg-slate-50 p-5 rounded-2xl border-2 border-dashed border-slate-200 hover:border-blue-400 transition-colors">
                        <h4 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                            <Upload size={18} className="text-blue-500" />
                            Novo Upload
                        </h4>

                        <div className="flex flex-col sm:flex-row gap-4">
                            <select
                                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                                value={selectedType}
                                onChange={e => setSelectedType(e.target.value)}
                            >
                                {DOCUMENT_TYPES.map(type => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                            </select>

                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploadProgress !== null}
                                className="px-6 py-2.5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 whitespace-nowrap"
                            >
                                {uploadProgress !== null ? (
                                    `Enviando ${Math.round(uploadProgress)}%`
                                ) : (
                                    <>Escolher Arquivo</>
                                )}
                            </button>
                            <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                onChange={handleFileChange}
                            />
                        </div>

                        {uploadProgress !== null && (
                            <div className="mt-4 h-2 bg-slate-200 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-blue-500 transition-all duration-300"
                                    style={{ width: `${uploadProgress}%` }}
                                ></div>
                            </div>
                        )}
                    </div>

                    {/* Documents List */}
                    <div>
                        <h4 className="font-bold text-slate-900 text-lg mb-4">Arquivos Armazenados</h4>

                        {(!tenant.documents || tenant.documents.length === 0) ? (
                            <div className="text-center py-10 bg-slate-50 rounded-2xl border border-slate-100">
                                <FileText size={48} className="mx-auto text-slate-300 mb-2" />
                                <p className="text-slate-400 font-medium">Nenhum documento encontrado.</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {tenant.documents.map((doc) => (
                                    <div key={doc.id} className="flex items-center justify-between p-4 bg-white border border-slate-100 rounded-xl hover:shadow-md transition-shadow group">
                                        <div className="flex items-center gap-4 overflow-hidden">
                                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${doc.type.includes('Vídeo') ? 'bg-purple-50 text-purple-600' : 'bg-blue-50 text-blue-600'
                                                }`}>
                                                {doc.type.includes('Vídeo') ? <FileText size={20} /> : <FileText size={20} />}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-bold text-slate-800 text-sm truncate">{doc.type}</p>
                                                <p className="text-xs text-slate-400 truncate">{doc.name} • {new Date(doc.uploadedAt).toLocaleDateString()}</p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <a
                                                href={doc.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                title="Visualizar"
                                            >
                                                <ExternalLink size={18} />
                                            </a>
                                            <button
                                                onClick={() => handleDelete(doc.id, doc.url)}
                                                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                title="Excluir"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                </div>
            </div>
        </div>
    );
};
