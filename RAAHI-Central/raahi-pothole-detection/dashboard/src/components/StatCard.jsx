import React from 'react';

export default function StatCard({label,value,sub,icon,accent='blue',onClick}){
  return <button className={`stat-card ${accent}`} onClick={onClick}>
    <div className="stat-icon">{icon}</div><div className="stat-copy"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>
  </button>
}
