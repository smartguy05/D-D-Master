import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { HostPage } from "./host/HostPage";
import { TablePage } from "./table/TablePage";
import "./styles/app.css";

function Home() {
  return (
    <div className="home">
      <h1>AI Dungeon Master</h1>
      <p>Open the host controls on the laptop and the table view on the TV.</p>
      <div className="row">
        <Link className="button primary big" to="/host">
          Host controls
        </Link>
        <Link className="button big" to="/table">
          Table screen
        </Link>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/host" element={<HostPage />} />
        <Route path="/table" element={<TablePage />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
