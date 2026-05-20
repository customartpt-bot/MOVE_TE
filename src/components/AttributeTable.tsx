import React from 'react';
import { X, Table as TableIcon, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface AttributeTableProps {
  data: any[];
  isOpen: boolean;
  onClose: () => void;
}

export function AttributeTable({ data, isOpen, onClose }: AttributeTableProps) {
  if (!isOpen) return null;

  const allowedKeys = [
    'nome_clube',
    'morada',
    'nome_freguesia',
    'nome_uniao_freguesia',
    'email',
    'website',
    'modalidade',
    'categoria',
    'mensalidade'
  ];

  const getHeaderLabel = (key: string) => {
    const labels: Record<string, string> = {
      'nome_clube': 'Entidade',
      'nome_freguesia': 'Freguesia',
      'nome_uniao_freguesia': 'União de Freguesia',
      'modalidade': 'Modalidade',
      'categoria': 'Categoria',
      'mensalidade': 'Mensalidade'
    };
    return labels[key] || key.replace(/_/g, ' ').toUpperCase();
  };

  const currentAllowedKeys = data.length > 0 && Object.keys(data[0]).some(k => allowedKeys.includes(k))
    ? allowedKeys.filter(k => data.length > 0 && Object.keys(data[0]).includes(k))
    : (data.length > 0 ? Object.keys(data[0]).filter(k => !k.toLowerCase().includes('geom') && k !== 'geometry').slice(0, 10) : []);

  const exportToCSV = () => {
    if (data.length === 0) return;
    // CHAMADA AO SCRIPT VANILLA JS (PROGWEB_JS_Tools.js)
    if (typeof (window as any).exportarParaCSV === 'function') {
      (window as any).exportarParaCSV(data, 'exportacao_move_te.csv');
    } else {
      console.error("Script de exportação não carregado.");
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="absolute bottom-0 left-0 right-0 h-[300px] bg-white border-t-4 border-dark-ink z-[1000] flex flex-col shadow-[0_-10px_25px_rgba(0,0,0,0.1)] font-sans"
      >
        {/* Toolbar */}
        <div className="bg-dark-ink text-pearl px-4 py-2 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            <TableIcon size={16} className="text-tech-green" />
            <span className="text-[10px] font-black uppercase tracking-widest">
              Tabela de Atributos ({data.length} registos)
            </span>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={exportToCSV}
              className="flex items-center gap-1.5 hover:text-tech-green transition-colors text-[10px] font-bold uppercase tracking-tighter"
            >
              <Download size={14} />
              Exportar CSV
            </button>
            <button 
              onClick={onClose}
              className="hover:text-tech-green transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Table Content */}
        <div className="flex-1 overflow-auto custom-scrollbar">
          {data.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-400 font-mono text-xs uppercase italic">
              Nenhum dado para exibir
            </div>
          ) : (
            <table className="w-full text-left border-collapse min-w-max">
              <thead className="sticky top-0 bg-pearl z-10">
                <tr>
                  {currentAllowedKeys.map((key) => (
                    <th 
                      key={key} 
                      className="px-4 py-2 border-b-2 border-dark-ink text-[9px] font-black uppercase tracking-widest text-dark-ink/60"
                    >
                      {getHeaderLabel(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.map((row, i) => (
                  <tr key={i} className="hover:bg-tech-green/5 transition-colors">
                    {currentAllowedKeys.map((key, j) => (
                      <td key={j} className="px-4 py-2 font-mono text-[10px] text-dark-ink whitespace-nowrap">
                        {String(row[key] || '-')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
