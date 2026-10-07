import type {NextConfig} from "next";
const config:NextConfig={output:"export",images:{unoptimized:true},experimental:{webpackBuildWorker:false,cpus:1}};
export default config;
